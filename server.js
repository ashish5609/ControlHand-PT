import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { execFile } from 'child_process';

// ============================================================
// ES MODULE PATH SETUP
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// DIRECTORY SETUP
// ============================================================

const uploadsDir = path.join(__dirname, 'uploads');
const pptDir = path.join(__dirname, 'public', 'ppt');
const libreOfficeProfileDir = path.join(__dirname, 'lo-profiles');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(pptDir, { recursive: true });
fs.mkdirSync(libreOfficeProfileDir, { recursive: true });

// Multer upload configuration
const upload = multer({
  dest: uploadsDir
});

// ============================================================
// EXPRESS + HTTP + SOCKET.IO
// ============================================================

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// ============================================================
// LOCAL IP DETECTION
// ============================================================

function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  const ipv4Addresses = [];

  for (const interfaceName of Object.keys(interfaces)) {
    const interfaceList = interfaces[interfaceName] || [];

    for (const iface of interfaceList) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const nameLower = interfaceName.toLowerCase();

        // Ignore virtual adapters
        if (
          nameLower.includes('virtual') ||
          nameLower.includes('vbox') ||
          nameLower.includes('vmnet') ||
          nameLower.includes('wsl') ||
          iface.mac === '0a:00:27:00:00:03'
        ) {
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

  // Prefer Wi-Fi
  const wifiIp = ipv4Addresses.find((ip) => {
    const nameLower = ip.name.toLowerCase();

    return (
      nameLower.includes('wi-fi') ||
      nameLower.includes('wifi') ||
      nameLower.includes('wlan') ||
      nameLower.includes('wireless')
    );
  });

  if (wifiIp) {
    return wifiIp.address;
  }

  // Then Ethernet
  const ethIp = ipv4Addresses.find((ip) =>
    ip.name.toLowerCase().includes('ethernet')
  );

  if (ethIp) {
    return ethIp.address;
  }

  // Fallback
  return ipv4Addresses[0].address;
}

// ============================================================
// URL HELPERS
// ============================================================

const remoteURL = `http://${getLocalIPAddress()}:${PORT}/remote.html`;

function getBaseURL(req) {
  // Render normally gives HTTPS externally.
  const protocol =
    req.headers['x-forwarded-proto'] ||
    req.protocol ||
    'https';

  const host = req.get('host');

  return `${protocol}://${host}`;
}

// ============================================================
// STATIC FILES
// ============================================================

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// BASIC HEALTH CHECK
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'ControlHand PT server is running',
    libreOfficeCommand: 'libreoffice'
  });
});

// ============================================================
// CONFIG API
// ============================================================

app.get('/api/config', async (req, res) => {
  try {
    const baseURL = getBaseURL(req);
    const remoteURLForRequest = `${baseURL}/remote.html`;

    const qrCodeDataUrl = await QRCode.toDataURL(
      remoteURLForRequest,
      {
        color: {
          dark: '#1e293b',
          light: '#ffffff'
        },
        width: 300,
        margin: 2
      }
    );

    res.json({
      localIP: getLocalIPAddress(),
      port: PORT,
      remoteURL: remoteURLForRequest,
      qrCodeDataUrl
    });
  } catch (err) {
    console.error('Error generating QR code:', err);

    res.status(500).json({
      error: 'Failed to generate configuration'
    });
  }
});

// ============================================================
// STATIC slides.json API
// ============================================================

app.get('/api/slides', (req, res) => {
  const slidesPath = path.join(__dirname, 'slides.json');

  fs.readFile(slidesPath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading slides.json:', err);

      return res.json([
        {
          title: 'Presentation Load Error',
          subtitle: 'slides.json could not be loaded',
          bullets: [
            'Please verify that slides.json exists and is valid JSON.'
          ],
          notes: 'Verify file presence.'
        }
      ]);
    }

    try {
      const slides = JSON.parse(data);
      res.json(slides);
    } catch (parseErr) {
      console.error('Error parsing slides.json:', parseErr);

      res.status(500).json({
        error: 'Invalid JSON in slides.json'
      });
    }
  });
});

// ============================================================
// PRESENTATION STATE
// ============================================================

let currentSlideIndex = 0;
let totalSlidesCount = 0;

// ============================================================
// SOCKET.IO
// ============================================================

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Send current state to newly connected client
  socket.emit('state-update', {
    currentSlideIndex,
    totalSlidesCount
  });

  // ----------------------------------------------------------
  // TOTAL SLIDE COUNT
  // ----------------------------------------------------------

  socket.on('set-total-slides', (count) => {
    const numericCount = Number(count);

    if (!Number.isFinite(numericCount) || numericCount < 0) {
      return;
    }

    totalSlidesCount = Math.floor(numericCount);

    // Keep current index valid
    if (
      totalSlidesCount > 0 &&
      currentSlideIndex >= totalSlidesCount
    ) {
      currentSlideIndex = totalSlidesCount - 1;
    }

    io.emit('state-update', {
      currentSlideIndex,
      totalSlidesCount
    });
  });

  // ----------------------------------------------------------
  // NEXT SLIDE
  // ----------------------------------------------------------

  socket.on('next-slide', () => {
    if (
      totalSlidesCount > 0 &&
      currentSlideIndex < totalSlidesCount - 1
    ) {
      currentSlideIndex++;

      io.emit('state-update', {
        currentSlideIndex,
        totalSlidesCount
      });

      console.log(
        `Slide changed to: ${currentSlideIndex}`
      );
    }
  });

  // ----------------------------------------------------------
  // PREVIOUS SLIDE
  // ----------------------------------------------------------

  socket.on('prev-slide', () => {
    if (currentSlideIndex > 0) {
      currentSlideIndex--;

      io.emit('state-update', {
        currentSlideIndex,
        totalSlidesCount
      });

      console.log(
        `Slide changed to: ${currentSlideIndex}`
      );
    }
  });

  // ----------------------------------------------------------
  // GOTO SLIDE
  // ----------------------------------------------------------

  socket.on('goto-slide', (index) => {
    const numericIndex = Number(index);

    if (
      Number.isInteger(numericIndex) &&
      numericIndex >= 0 &&
      numericIndex < totalSlidesCount
    ) {
      currentSlideIndex = numericIndex;

      io.emit('state-update', {
        currentSlideIndex,
        totalSlidesCount
      });

      console.log(
        `Slide jumped to: ${currentSlideIndex}`
      );
    }
  });

  // ----------------------------------------------------------
  // REQUEST SYNC
  // ----------------------------------------------------------

  socket.on('request-sync', () => {
    socket.emit('state-update', {
      currentSlideIndex,
      totalSlidesCount
    });
  });

  // ----------------------------------------------------------
  // LASER POINTER
  // ----------------------------------------------------------

  socket.on('laser-move', (coords) => {
    socket.broadcast.emit('laser-moved', coords);
  });

  socket.on('laser-toggle', (state) => {
    socket.broadcast.emit('laser-toggled', state);
  });

  // ----------------------------------------------------------
  // DISCONNECT
  // ----------------------------------------------------------

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// ============================================================
// PPT UPLOAD
// ============================================================

const pptUpload = upload.single('ppt');

// ============================================================
// FIND LIBREOFFICE
// ============================================================

function getLibreOfficeCommand() {
  // We expect the Docker image to install this as "libreoffice".
  // Keep this in one place so it can be changed easily later.
  return 'libreoffice';
}

// ============================================================
// PPT -> PNG CONVERSION
// ============================================================

app.post('/api/ppt/upload', pptUpload, (req, res) => {
  console.log('');
  console.log('==============================================');
  console.log('            PPT UPLOAD STARTED');
  console.log('==============================================');

  console.log('Request method:', req.method);
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Uploaded file:', req.file);

  // ----------------------------------------------------------
  // CHECK FILE
  // ----------------------------------------------------------

  if (!req.file) {
    console.error('No file uploaded.');

    return res.status(400).json({
      error: 'No file uploaded'
    });
  }

  // ----------------------------------------------------------
  // VALIDATE EXTENSION
  // ----------------------------------------------------------

  const originalName = req.file.originalname;
  const ext = path.extname(originalName).toLowerCase();

  console.log('Original file:', originalName);
  console.log('Extension:', ext);

  if (ext !== '.ppt' && ext !== '.pptx') {
    try {
      fs.unlinkSync(req.file.path);
    } catch (_) {}

    return res.status(400).json({
      error: 'Only .ppt or .pptx files are supported'
    });
  }

  // ----------------------------------------------------------
  // CREATE SAFE PRESENTATION ID
  // ----------------------------------------------------------

  let presentationId = path
    .parse(originalName)
    .name
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '');

  // Prevent empty ID
  if (!presentationId) {
    presentationId = `presentation_${Date.now()}`;
  }

  console.log('Presentation ID:', presentationId);

  // ----------------------------------------------------------
  // OUTPUT DIRECTORY
  // ----------------------------------------------------------

  const outDir = path.join(
    pptDir,
    presentationId
  );

  // Remove old output if same presentation name was uploaded
  try {
    fs.rmSync(outDir, {
      recursive: true,
      force: true
    });
  } catch (cleanupError) {
    console.error(
      'Error cleaning old presentation folder:',
      cleanupError
    );
  }

  fs.mkdirSync(outDir, {
    recursive: true
  });

  console.log('Output directory:', outDir);

  // ----------------------------------------------------------
  // GIVE UPLOADED FILE ITS REAL EXTENSION
  // ----------------------------------------------------------

  const srcPath = path.resolve(
    req.file.path + ext
  );

  try {
    fs.renameSync(
      req.file.path,
      srcPath
    );
  } catch (renameError) {
    console.error(
      'Could not rename uploaded file:',
      renameError
    );

    return res.status(500).json({
      error: 'Could not prepare uploaded PowerPoint file',
      details: renameError.message
    });
  }

  console.log('Source PowerPoint:', srcPath);

  // ----------------------------------------------------------
  // CHECK SOURCE EXISTS
  // ----------------------------------------------------------

  if (!fs.existsSync(srcPath)) {
    console.error(
      'Source PPTX does not exist:',
      srcPath
    );

    return res.status(500).json({
      error: 'Uploaded file could not be found after upload'
    });
  }

  // ----------------------------------------------------------
  // LIBREOFFICE PROFILE
  // ----------------------------------------------------------
  //
  // Each presentation gets its own temporary profile.
  // This avoids lock/profile conflicts on Linux/Render.
  //

  const loProfile = path.join(
    libreOfficeProfileDir,
    `${presentationId}_${Date.now()}`
  );

  fs.mkdirSync(loProfile, {
    recursive: true
  });

  // ----------------------------------------------------------
  // LIBREOFFICE COMMAND
  // ----------------------------------------------------------

  const libreOfficeCommand =
    getLibreOfficeCommand();

  const libreOfficeArgs = [
    '--headless',
    '--nologo',
    '--nodefault',
    '--nofirststartwizard',
    '--norestore',
    '--nolockcheck',

    // Unique user profile for this conversion
    `-env:UserInstallation=file://${loProfile}`,

    // Explicit conversion format
    '--convert-to',
    'png',

    // Output folder
    '--outdir',
    outDir,

    // Input file
    srcPath
  ];

  console.log('');
  console.log('----------------------------------------------');
  console.log('Starting LibreOffice conversion');
  console.log('----------------------------------------------');
  console.log('Command:', libreOfficeCommand);
  console.log('Arguments:', libreOfficeArgs);
  console.log('Source exists:', fs.existsSync(srcPath));
  console.log('Output exists:', fs.existsSync(outDir));
  console.log('----------------------------------------------');

  // ----------------------------------------------------------
  // EXECUTE LIBREOFFICE
  // ----------------------------------------------------------

  execFile(
    libreOfficeCommand,
    libreOfficeArgs,
    {
      timeout: 180000,
      maxBuffer: 10 * 1024 * 1024
    },
    (err, stdout, stderr) => {
      console.log('');
      console.log('==============================================');
      console.log('         LIBREOFFICE CONVERSION RESULT');
      console.log('==============================================');

      console.log('Exit error:', err);
      console.log('STDOUT:');
      console.log(stdout || '(empty)');

      console.log('STDERR:');
      console.log(stderr || '(empty)');

      console.log('==============================================');

      // --------------------------------------------------------
      // REMOVE SOURCE PPT/PPTX
      // --------------------------------------------------------

      try {
        if (fs.existsSync(srcPath)) {
          fs.unlinkSync(srcPath);
          console.log(
            'Temporary PowerPoint file deleted.'
          );
        }
      } catch (deleteError) {
        console.error(
          'Could not delete source file:',
          deleteError
        );
      }

      // --------------------------------------------------------
      // CONVERSION FAILED
      // --------------------------------------------------------

      if (err) {
        console.error(
          'LibreOffice conversion FAILED.'
        );

        return res.status(500).json({
          error: 'PowerPoint conversion failed',
          message: err.message,
          stdout: stdout || '',
          stderr: stderr || ''
        });
      }

      // --------------------------------------------------------
      // CHECK OUTPUT DIRECTORY
      // --------------------------------------------------------

      if (!fs.existsSync(outDir)) {
        console.error(
          'LibreOffice did not create output directory.'
        );

        return res.status(500).json({
          error: 'Conversion completed but output directory was not created',
          stdout: stdout || '',
          stderr: stderr || ''
        });
      }

      console.log(
        'Files immediately after conversion:',
        fs.readdirSync(outDir)
      );

      // --------------------------------------------------------
      // HANDLE POSSIBLE NESTED OUTPUT DIRECTORY
      // --------------------------------------------------------
      //
      // Some LibreOffice/Impress configurations may create:
      //
      // outDir/
      //   presentation/
      //      1.png
      //      2.png
      //
      // We flatten that structure.
      //

      try {
        const entries = fs.readdirSync(outDir);

        const subdirs = entries.filter((entry) => {
          try {
            return fs
              .statSync(path.join(outDir, entry))
              .isDirectory();
          } catch (_) {
            return false;
          }
        });

        console.log(
          'Subdirectories found:',
          subdirs
        );

        if (subdirs.length === 1) {
          const subPath = path.join(
            outDir,
            subdirs[0]
          );

          const subFiles = fs.readdirSync(
            subPath
          );

          console.log(
            'Flattening nested directory:',
            subPath
          );

          for (const file of subFiles) {
            const sourceFile = path.join(
              subPath,
              file
            );

            const destinationFile = path.join(
              outDir,
              file
            );

            // Only move files
            if (
              fs.existsSync(sourceFile) &&
              fs.statSync(sourceFile).isFile()
            ) {
              fs.renameSync(
                sourceFile,
                destinationFile
              );
            }
          }

          fs.rmSync(subPath, {
            recursive: true,
            force: true
          });

          console.log(
            'Nested output directory removed.'
          );
        }
      } catch (flattenError) {
        console.error(
          'Error while flattening LibreOffice output:',
          flattenError
        );

        return res.status(500).json({
          error: 'Could not process converted slide files',
          details: flattenError.message
        });
      }

      // --------------------------------------------------------
      // COLLECT PNG/JPG FILES
      // --------------------------------------------------------

      let files = [];

      try {
        files = fs
          .readdirSync(outDir)
          .filter((file) =>
            /\.(png|jpg|jpeg)$/i.test(file)
          )
          .sort((a, b) =>
            a.localeCompare(
              b,
              undefined,
              {
                numeric: true
              }
            )
          );
      } catch (readError) {
        console.error(
          'Could not read output directory:',
          readError
        );

        return res.status(500).json({
          error: 'Could not read converted slides',
          details: readError.message
        });
      }

      console.log('');
      console.log('==============================================');
      console.log('             CONVERTED SLIDES');
      console.log('==============================================');
      console.log('Files:', files);
      console.log('Slide count:', files.length);
      console.log('==============================================');

      // --------------------------------------------------------
      // NO SLIDES
      // --------------------------------------------------------

      if (files.length === 0) {
        console.error(
          'LibreOffice returned success but no PNG files were found.'
        );

        return res.status(500).json({
          error: 'Conversion produced no slides',
          stdout: stdout || '',
          stderr: stderr || ''
        });
      }

      // --------------------------------------------------------
      // CREATE SLIDE JSON
      // --------------------------------------------------------

      const slides = files.map(
        (file, index) => ({
          title: `Slide ${index + 1}`,
          image: `ppt/${presentationId}/${file}`
        })
      );

      const jsonPath = path.join(
        pptDir,
        `${presentationId}-slides.json`
      );

      try {
        fs.writeFileSync(
          jsonPath,
          JSON.stringify(
            slides,
            null,
            2
          ),
          'utf8'
        );
      } catch (jsonError) {
        console.error(
          'Could not create slides JSON:',
          jsonError
        );

        return res.status(500).json({
          error: 'Could not create presentation metadata',
          details: jsonError.message
        });
      }

      // --------------------------------------------------------
      // DELETE LIBREOFFICE PROFILE
      // --------------------------------------------------------

      try {
        fs.rmSync(
          loProfile,
          {
            recursive: true,
            force: true
          }
        );
      } catch (profileError) {
        console.warn(
          'Could not remove LibreOffice profile:',
          profileError.message
        );
      }

      console.log('');
      console.log('==============================================');
      console.log('       PPT CONVERSION SUCCESSFUL');
      console.log('==============================================');
      console.log(
        'Presentation ID:',
        presentationId
      );
      console.log(
        'Slide count:',
        slides.length
      );
      console.log(
        'JSON:',
        jsonPath
      );
      console.log('==============================================');

      // --------------------------------------------------------
      // RESPONSE
      // --------------------------------------------------------

      return res.json({
        presentationId,
        slideCount: slides.length
      });
    }
  );
});

// ============================================================
// GET SLIDES FOR PRESENTATION
// ============================================================

app.get('/api/ppt/slides/:id', (req, res) => {
  const id = req.params.id;

  const jsonPath = path.join(
    pptDir,
    `${id}-slides.json`
  );

  if (!fs.existsSync(jsonPath)) {
    return res.status(404).json({
      error: 'Presentation not found'
    });
  }

  try {
    const data = fs.readFileSync(
      jsonPath,
      'utf8'
    );

    res.json(
      JSON.parse(data)
    );
  } catch (error) {
    console.error(
      'Error reading presentation JSON:',
      error
    );

    res.status(500).json({
      error: 'Could not read presentation data'
    });
  }
});

// ============================================================
// PPT CONFIG / QR
// ============================================================

app.get(
  '/api/ppt/config/:id',
  async (req, res) => {
    try {
      const id = req.params.id;

      const baseURL = getBaseURL(req);

      const viewerURL =
        `${baseURL}/ppt-view.html?id=${encodeURIComponent(id)}`;

      const phoneRemoteURL =
        `${baseURL}/remote.html?ppt=${encodeURIComponent(id)}`;

      const qrCodeDataUrl =
        await QRCode.toDataURL(
          phoneRemoteURL,
          {
            color: {
              dark: '#1e293b',
              light: '#ffffff'
            },
            width: 300,
            margin: 2
          }
        );

      res.json({
        viewerURL,
        phoneRemoteURL,
        qrCodeDataUrl,
        port: PORT
      });
    } catch (error) {
      console.error(
        'QR config error:',
        error
      );

      res.status(500).json({
        error: 'Failed to generate QR'
      });
    }
  }
);

// ============================================================
// START SERVER
// ============================================================

httpServer.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log('');
    console.log(
      '=================================================='
    );
    console.log(
      '        ControlHand PT Server is running'
    );
    console.log(
      '=================================================='
    );

    console.log(
      `Local Access: http://localhost:${PORT}`
    );

    console.log(
      `Remote Access: ${remoteURL}`
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      'Environment:',
      process.env.RENDER
        ? 'Render'
        : 'Local'
    );

    console.log(
      '=================================================='
    );
  }
);
