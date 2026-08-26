import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
// Multer for handling PPT uploads
import multer from 'multer';
import { exec } from 'child_process';
// Resolve directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const upload = multer({ dest: path.join(__dirname, 'uploads') });

// Ensure required directories exist
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public', 'ppt'), { recursive: true });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Helper to get local IP address, prioritizing Wi-Fi interfaces
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  const ipv4Addresses = [];

  for (const interfaceName of Object.keys(interfaces)) {
    for (const iface of interfaces[interfaceName]) {
      // Check for IPv4 and ensure it's not a loopback/internal address
      if (iface.family === 'IPv4' && !iface.internal) {
        const nameLower = interfaceName.toLowerCase();
        // Exclude virtual/host-only network interfaces (like VMware/VirtualBox adapters) if possible
        if (nameLower.includes('virtual') || 
            nameLower.includes('vbox') || 
            nameLower.includes('vmnet') ||
            nameLower.includes('wsl') ||
            // Exclude VirtualBox host-only ethernet adapter (often named 'Ethernet 2' or similar with Mac address 0a:00:27...)
            iface.mac === '0a:00:27:00:00:03') {
          continue;
        }
        ipv4Addresses.push({
          name: interfaceName,
          address: iface.address
        });
      }
    }
  }

  if (ipv4Addresses.length === 0) {
    return 'localhost';
  }

  // 1. Prioritize Wi-Fi/Wireless connections which are standard for phone pairing
  const wifiIp = ipv4Addresses.find(ip => {
    const nameLower = ip.name.toLowerCase();
    return nameLower.includes('wi-fi') || 
           nameLower.includes('wifi') || 
           nameLower.includes('wlan') || 
           nameLower.includes('wireless');
  });
  if (wifiIp) return wifiIp.address;

  // 2. Next, look for Ethernet/LAN connections
  const ethIp = ipv4Addresses.find(ip => ip.name.toLowerCase().includes('ethernet'));
  if (ethIp) return ethIp.address;

  // 3. Fallback to first detected address
  return ipv4Addresses[0].address;
}

const localIP = getLocalIPAddress();
const remoteURL = `http://${localIP}:${PORT}/remote.html`;

// Serve public directory
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint to get configuration (IP, remote URL, QR Code)
app.get('/api/config', async (req, res) => {
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(remoteURL, {
      color: {
        dark: '#1e293b', // Slate 800
        light: '#ffffff'
      },
      width: 300,
      margin: 2
    });
    res.json({
      localIP,
      port: PORT,
      remoteURL,
      qrCodeDataUrl
    });
  } catch (err) {
    console.error('Error generating QR code:', err);
    res.status(500).json({ error: 'Failed to generate configuration' });
  }
});

// API endpoint to fetch slides.json dynamically (allows hot reloading without server restart)
app.get('/api/slides', (req, res) => {
  const slidesPath = path.join(__dirname, 'slides.json');
  fs.readFile(slidesPath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading slides.json:', err);
      // Fallback slides in case of read error
      return res.json([
        {
          title: "Presentation Load Error",
          subtitle: "slides.json could not be loaded",
          bullets: ["Please verify that slides.json exists and is valid JSON."],
          notes: "Verify file presence."
        }
      ]);
    }
    try {
      const slides = JSON.parse(data);
      res.json(slides);
    } catch (parseErr) {
      console.error('Error parsing slides.json:', parseErr);
      res.status(500).json({ error: 'Invalid JSON in slides.json' });
    }
  });
});

// Presentation State
let currentSlideIndex = 0;
let totalSlidesCount = 0;

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Send initial state to newly connected client
  socket.emit('state-update', {
    currentSlideIndex
  });

  // When a client updates the total slides count
  socket.on('set-total-slides', (count) => {
    totalSlidesCount = count;
    io.emit('state-update', {
      currentSlideIndex,
      totalSlidesCount
    });
  });

  // Slide navigation events from remote
  socket.on('next-slide', () => {
    if (totalSlidesCount > 0 && currentSlideIndex < totalSlidesCount - 1) {
      currentSlideIndex++;
      io.emit('state-update', { currentSlideIndex });
      console.log(`Slide changed to: ${currentSlideIndex}`);
    }
  });

  socket.on('prev-slide', () => {
    if (currentSlideIndex > 0) {
      currentSlideIndex--;
      io.emit('state-update', { currentSlideIndex });
      console.log(`Slide changed to: ${currentSlideIndex}`);
    }
  });

  socket.on('goto-slide', (index) => {
    if (index >= 0 && index < totalSlidesCount) {
      currentSlideIndex = index;
      io.emit('state-update', { currentSlideIndex });
      console.log(`Slide jumped to: ${currentSlideIndex}`);
    }
  });

  // Real-time synchronization request from a remote (re-sync)
  socket.on('request-sync', () => {
    socket.emit('state-update', {
      currentSlideIndex,
      totalSlidesCount
    });
  });

  // Laser pointer events
  socket.on('laser-move', (coords) => {
    // Broadcast laser coordinates to all other clients (primarily the presentation viewer)
    socket.broadcast.emit('laser-moved', coords);
  });

  socket.on('laser-toggle', (state) => {
    // Broadcast active status to all other clients
    socket.broadcast.emit('laser-toggled', state);
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ---------------------------------------------------
// PPT upload & conversion (Option B – PowerPoint COM)
// ---------------------------------------------------
const pptUpload = upload.single('ppt');

app.post('/api/ppt/upload', pptUpload, (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const originalName = req.file.originalname;
  const ext = path.extname(originalName).toLowerCase();
  if (ext !== '.ppt' && ext !== '.pptx') {
    return res.status(400).json({ error: 'Only .ppt or .pptx files are supported' });
  }
  const presentationId = path.parse(originalName).name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
  const outDir = path.join(__dirname, 'public', 'ppt', presentationId);
  fs.mkdirSync(outDir, { recursive: true });

  // Rename uploaded file to have proper extension so PowerPoint can open it
  const srcPath = path.resolve(req.file.path + ext);
  fs.renameSync(req.file.path, srcPath);

  // Build PowerShell script as a temp .ps1 file to avoid escaping nightmares
  const psScript = `
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $pres = $ppt.Presentations.Open("${srcPath}", [Microsoft.Office.Core.MsoTriState]::msoFalse, [Microsoft.Office.Core.MsoTriState]::msoTrue, [Microsoft.Office.Core.MsoTriState]::msoFalse)
  $pres.SaveAs("${outDir}", 17)
  $pres.Close()
} finally {
  $ppt.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
`;
  const psScriptPath = path.join(__dirname, 'uploads', `convert_${presentationId}.ps1`);
  fs.writeFileSync(psScriptPath, psScript, 'utf8');

  exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, { timeout: 120000 }, (err) => {
    // Clean up script file
    try { fs.unlinkSync(psScriptPath); } catch(_) {}
    try { fs.unlinkSync(srcPath); } catch(_) {}

    if (err) {
      console.error('PowerPoint conversion error:', err);
      return res.status(500).json({ error: 'Conversion failed. Make sure PowerPoint is installed.' });
    }

    // PowerPoint SaveAs with format 17 (PNG) creates a subfolder, or puts PNGs directly in outDir
    // Check if a subfolder was created
    let pngDir = outDir;
    const subdirs = fs.readdirSync(outDir).filter(f => fs.statSync(path.join(outDir, f)).isDirectory());
    if (subdirs.length === 1) {
      // Move PNGs from subfolder to outDir
      const subPath = path.join(outDir, subdirs[0]);
      const subFiles = fs.readdirSync(subPath);
      for (const f of subFiles) {
        fs.renameSync(path.join(subPath, f), path.join(outDir, f));
      }
      fs.rmdirSync(subPath);
    }

    const files = fs.readdirSync(outDir)
      .filter(f => /\.(png|jpg|jpeg)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (files.length === 0) {
      return res.status(500).json({ error: 'Conversion produced no slides. Please try again.' });
    }

    const slides = files.map((file, idx) => ({ title: `Slide ${idx + 1}`, image: `ppt/${presentationId}/${file}` }));
    const jsonPath = path.join(__dirname, 'public', 'ppt', `${presentationId}-slides.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(slides, null, 2), 'utf8');
    res.json({ presentationId, slideCount: slides.length });
  });
});

app.get('/api/ppt/slides/:id', (req, res) => {
  const id = req.params.id;
  const jsonPath = path.join(__dirname, 'public', 'ppt', `${id}-slides.json`);
  if (!fs.existsSync(jsonPath)) {
    return res.status(404).json({ error: 'Presentation not found' });
  }
  const data = fs.readFileSync(jsonPath, 'utf8');
  res.json(JSON.parse(data));
});

app.get('/api/ppt/config/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const baseURL = `http://${localIP}:${PORT}`;
    const viewerURL = `${baseURL}/ppt-view.html?id=${id}`;
    const phoneRemoteURL = `${baseURL}/remote.html?ppt=${id}`;
    const qrCodeDataUrl = await QRCode.toDataURL(phoneRemoteURL, { color: { dark: '#1e293b', light: '#ffffff' }, width: 300, margin: 2 });
    res.json({ viewerURL, phoneRemoteURL, qrCodeDataUrl, localIP, port: PORT });
  } catch (e) {
    console.error('QR config error:', e);
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

// Start Server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('==================================================');
  console.log(`  ControlHand PT Server is running!`);
  console.log(`  Local Access (Laptop): http://localhost:${PORT}`);
  console.log(`  Remote Access (Phone): ${remoteURL}`);
  console.log(`  Make sure both devices are on the SAME Wi-Fi network.`);
  console.log('==================================================');
});
