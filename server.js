import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';
import { fileURLToPath, pathToFileURL } from 'url';
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

// ============================================================
// MULTER
// ============================================================

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
// LOCAL IP ADDRESS
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

  return ipv4Addresses[0].address;
}

// ============================================================
// URL HELPERS
// ============================================================

const remoteURL =
  `http://${getLocalIPAddress()}:${PORT}/remote.html`;

function getBaseURL(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];

  const protocol =
    forwardedProto ||
    req.protocol ||
    'https';

  const host = req.get('host');

  return `${protocol}://${host}`;
}

// ============================================================
// STATIC FILES
// ============================================================

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'ControlHand PT server is running',
    environment: process.env.RENDER ? 'Render' : 'Local'
  });
});

// ============================================================
// CHECK LIBREOFFICE
// ============================================================

app.get('/api/libreoffice', (req, res) => {
  execFile(
    'libreoffice',
    ['--version'],
    {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    },
    (error, stdout, stderr) => {
      if (error) {
        console.error(
          'LibreOffice check failed:',
          error
        );

        return res.status(500).json({
          installed: false,
          error: error.message,
          stdout: stdout || '',
          stderr: stderr || ''
        });
      }

      res.json({
        installed: true,
        version: (stdout || '').trim(),
        stderr: stderr || ''
      });
    }
  );
});

// ============================================================
// GENERAL CONFIG API
// ============================================================

app.get('/api/config', async (req, res) => {
  try {
    const baseURL = getBaseURL(req);

    const remoteURLForRequest =
      `${baseURL}/remote.html`;

    const qrCodeDataUrl =
      await QRCode.toDataURL(
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
  } catch (error) {
    console.error(
      'Error generating QR code:',
      error
    );

    res.status(500).json({
      error: 'Failed to generate configuration'
    });
  }
});

// ============================================================
// STATIC slides.json API
// ============================================================

app.get('/api/slides', (req, res) => {
  const slidesPath =
    path.join(__dirname, 'slides.json');

  fs.readFile(
    slidesPath,
    'utf8',
    (error, data) => {
      if (error) {
        console.error(
          'Error reading slides.json:',
          error
        );

        return res.json([
          {
            title: 'Presentation Load Error',
            subtitle:
              'slides.json could not be loaded',
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
      } catch (parseError) {
        console.error(
          'Error parsing slides.json:',
          parseError
        );

        res.status(500).json({
          error:
            'Invalid JSON in slides.json'
        });
      }
    }
  );
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
  console.log(
    `Client connected: ${socket.id}`
  );

  // ----------------------------------------------------------
  // INITIAL STATE
  // ----------------------------------------------------------

  socket.emit('state-update', {
    currentSlideIndex,
    totalSlidesCount
  });

  // ----------------------------------------------------------
  // SET TOTAL SLIDES
  // ----------------------------------------------------------

  socket.on(
    'set-total-slides',
    (count) => {
      const numericCount = Number(count);

      if (
        !Number.isFinite(numericCount) ||
        numericCount < 0
      ) {
        return;
      }

      totalSlidesCount =
        Math.floor(numericCount);

      if (
        totalSlidesCount > 0 &&
        currentSlideIndex >= totalSlidesCount
      ) {
        currentSlideIndex =
          totalSlidesCount - 1;
      }

      io.emit('state-update', {
        currentSlideIndex,
        totalSlidesCount
      });
    }
  );

  // ----------------------------------------------------------
  // NEXT SLIDE
  // ----------------------------------------------------------

  socket.on('next-slide', () => {
    if (
      totalSlidesCount > 0 &&
      currentSlideIndex <
        totalSlidesCount - 1
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
      currentSlideIndex =
        numericIndex;

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

  socket.on(
    'request-sync',
    () => {
      socket.emit('state-update', {
        currentSlideIndex,
        totalSlidesCount
      });
    }
  );

  // ----------------------------------------------------------
  // LASER POINTER
  // ----------------------------------------------------------

  socket.on(
    'laser-move',
    (coords) => {
      socket.broadcast.emit(
        'laser-moved',
        coords
      );
    }
  );

  socket.on(
    'laser-toggle',
    (state) => {
      socket.broadcast.emit(
        'laser-toggled',
        state
      );
    }
  );

  // ----------------------------------------------------------
  // DISCONNECT
  // ----------------------------------------------------------

  socket.on(
    'disconnect',
    () => {
      console.log(
        `Client disconnected: ${socket.id}`
      );
    }
  );
});

// ============================================================
// PPT UPLOAD
// ============================================================

const pptUpload =
  upload.single('ppt');

// ============================================================
// HELPER: SAFE PRESENTATION ID
// ============================================================

function createPresentationId(
  originalName
) {
  let id =
    path
      .parse(originalName)
      .name
      .replace(/\s+/g, '_')
      .replace(
        /[^a-zA-Z0-9_-]/g,
        ''
      );

  if (!id) {
    id =
      `presentation_${Date.now()}`;
  }

  return id;
}

// ============================================================
// HELPER: DELETE FILE SAFELY
// ============================================================

function safeDeleteFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn(
      `Could not delete file: ${filePath}`,
      error.message
    );
  }
}

// ============================================================
// HELPER: DELETE DIRECTORY SAFELY
// ============================================================

function safeDeleteDirectory(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(
        dirPath,
        {
          recursive: true,
          force: true
        }
      );
    }
  } catch (error) {
    console.warn(
      `Could not delete directory: ${dirPath}`,
      error.message
    );
  }
}

// ============================================================
// PPT -> PDF -> PNG
// ============================================================

app.post(
  '/api/ppt/upload',
  pptUpload,
  async (req, res) => {

    console.log('');
    console.log(
      '=================================================='
    );
    console.log(
      '              PPT UPLOAD STARTED'
    );
    console.log(
      '=================================================='
    );

    console.log(
      'Request method:',
      req.method
    );

    console.log(
      'Content-Type:',
      req.headers['content-type']
    );

    console.log(
      'Uploaded file:',
      req.file
    );

    // --------------------------------------------------------
    // CHECK FILE
    // --------------------------------------------------------

    if (!req.file) {
      return res.status(400).json({
        error: 'No file uploaded'
      });
    }

    const originalName =
      req.file.originalname;

    const ext =
      path
        .extname(originalName)
        .toLowerCase();

    console.log(
      'Original file:',
      originalName
    );

    console.log(
      'Extension:',
      ext
    );

    // --------------------------------------------------------
    // VALIDATE EXTENSION
    // --------------------------------------------------------

    if (
      ext !== '.ppt' &&
      ext !== '.pptx'
    ) {
      safeDeleteFile(
        req.file.path
      );

      return res.status(400).json({
        error:
          'Only .ppt or .pptx files are supported'
      });
    }

    // --------------------------------------------------------
    // PRESENTATION ID
    // --------------------------------------------------------

    const presentationId =
      createPresentationId(
        originalName
      );

    console.log(
      'Presentation ID:',
      presentationId
    );

    // --------------------------------------------------------
    // OUTPUT DIRECTORY
    // --------------------------------------------------------

    const outDir =
      path.join(
        pptDir,
        presentationId
      );

    // Remove previous version
    safeDeleteDirectory(
      outDir
    );

    fs.mkdirSync(
      outDir,
      {
        recursive: true
      }
    );

    console.log(
      'Output directory:',
      outDir
    );

    // --------------------------------------------------------
    // SOURCE POWERPOINT
    // --------------------------------------------------------

    const srcPath =
      path.resolve(
        req.file.path + ext
      );

    try {
      fs.renameSync(
        req.file.path,
        srcPath
      );
    } catch (error) {
      console.error(
        'Could not rename uploaded file:',
        error
      );

      safeDeleteFile(
        req.file.path
      );

      return res.status(500).json({
        error:
          'Could not prepare uploaded PowerPoint file',
        details:
          error.message
      });
    }

    console.log(
      'Source PowerPoint:',
      srcPath
    );

    if (!fs.existsSync(srcPath)) {
      return res.status(500).json({
        error:
          'Uploaded PowerPoint file does not exist'
      });
    }

    // --------------------------------------------------------
    // LIBREOFFICE TEMP PROFILE
    // --------------------------------------------------------

    const profileName =
      `${presentationId}_${Date.now()}`;

    const loProfile =
      path.join(
        libreOfficeProfileDir,
        profileName
      );

    fs.mkdirSync(
      loProfile,
      {
        recursive: true
      }
    );

    // Convert local path to proper file:// URL
    const loProfileURL =
      pathToFileURL(
        loProfile
      ).href;

    // --------------------------------------------------------
    // STEP 1: PPT/PPTX -> PDF
    // --------------------------------------------------------

    console.log('');
    console.log(
      '--------------------------------------------------'
    );
    console.log(
      'STEP 1: PowerPoint -> PDF'
    );
    console.log(
      '--------------------------------------------------'
    );

    const pdfArgs = [
      '--headless',
      '--nologo',
      '--nodefault',
      '--nofirststartwizard',
      '--norestore',
      '--nolockcheck',

      `-env:UserInstallation=${loProfileURL}`,

      '--convert-to',
      'pdf',

      '--outdir',
      outDir,

      srcPath
    ];

    console.log(
      'LibreOffice arguments:',
      pdfArgs
    );

    execFile(
      'libreoffice',
      pdfArgs,
      {
        timeout: 180000,
        maxBuffer:
          20 * 1024 * 1024
      },
      (pdfError, pdfStdout, pdfStderr) => {

        console.log('');
        console.log(
          '=================================================='
        );
        console.log(
          '             LIBREOFFICE PDF RESULT'
        );
        console.log(
          '=================================================='
        );

        console.log(
          'Error:',
          pdfError
        );

        console.log(
          'STDOUT:',
          pdfStdout || '(empty)'
        );

        console.log(
          'STDERR:',
          pdfStderr || '(empty)'
        );

        console.log(
          '=================================================='
        );

        // ----------------------------------------------------
        // PDF CONVERSION ERROR
        // ----------------------------------------------------

        if (pdfError) {
          safeDeleteFile(
            srcPath
          );

          safeDeleteDirectory(
            loProfile
          );

          return res.status(500).json({
            error:
              'PowerPoint to PDF conversion failed',
            message:
              pdfError.message,
            stdout:
              pdfStdout || '',
            stderr:
              pdfStderr || ''
          });
        }

        // ----------------------------------------------------
        // EXPECTED PDF PATH
        // ----------------------------------------------------

        const pdfFileName =
          `${path.parse(originalName).name}.pdf`;

        const pdfPath =
          path.join(
            outDir,
            pdfFileName
          );

        console.log(
          'Expected PDF:',
          pdfPath
        );

        // ----------------------------------------------------
        // FIND PDF IF NAME IS DIFFERENT
        // ----------------------------------------------------

        let actualPdfPath =
          pdfPath;

        if (
          !fs.existsSync(
            actualPdfPath
          )
        ) {
          try {
            const pdfFiles =
              fs
                .readdirSync(
                  outDir
                )
                .filter(
                  (file) =>
                    file
                      .toLowerCase()
                      .endsWith('.pdf')
                );

            console.log(
              'PDF files found:',
              pdfFiles
            );

            if (
              pdfFiles.length > 0
            ) {
              actualPdfPath =
                path.join(
                  outDir,
                  pdfFiles[0]
                );
            }
          } catch (error) {
            console.error(
              'Could not inspect output directory:',
              error
            );
          }
        }

        // ----------------------------------------------------
        // NO PDF
        // ----------------------------------------------------

        if (
          !fs.existsSync(
            actualPdfPath
          )
        ) {
          safeDeleteFile(
            srcPath
          );

          safeDeleteDirectory(
            loProfile
          );

          return res.status(500).json({
            error:
              'LibreOffice finished but no PDF was created',
            stdout:
              pdfStdout || '',
            stderr:
              pdfStderr || '',
            outputFiles:
              fs.existsSync(outDir)
                ? fs.readdirSync(outDir)
                : []
          });
        }

        console.log(
          'PDF successfully created:',
          actualPdfPath
        );

        // ----------------------------------------------------
        // STEP 2: PDF -> PNG
        // ----------------------------------------------------

        console.log('');
        console.log(
          '--------------------------------------------------'
        );
        console.log(
          'STEP 2: PDF -> PNG'
        );
        console.log(
          '--------------------------------------------------'
        );

        const pngPrefix =
          path.join(
            outDir,
            'slide'
          );

        const pdftoppmArgs = [
          '-png',

          // 150 DPI is good quality
          '-r',
          '150',

          actualPdfPath,
          pngPrefix
        ];

        console.log(
          'pdftoppm arguments:',
          pdftoppmArgs
        );

        execFile(
          'pdftoppm',
          pdftoppmArgs,
          {
            timeout: 180000,
            maxBuffer:
              20 * 1024 * 1024
          },
          (
            pngError,
            pngStdout,
            pngStderr
          ) => {

            console.log('');
            console.log(
              '=================================================='
            );
            console.log(
              '                PDF TO PNG RESULT'
            );
            console.log(
              '=================================================='
            );

            console.log(
              'Error:',
              pngError
            );

            console.log(
              'STDOUT:',
              pngStdout || '(empty)'
            );

            console.log(
              'STDERR:',
              pngStderr || '(empty)'
            );

            console.log(
              '=================================================='
            );

            // ------------------------------------------------
            // CLEAN SOURCE PPT
            // ------------------------------------------------

            safeDeleteFile(
              srcPath
            );

            // ------------------------------------------------
            // CLEAN PDF
            // ------------------------------------------------

            safeDeleteFile(
              actualPdfPath
            );

            // ------------------------------------------------
            // PDF -> PNG ERROR
            // ------------------------------------------------

            if (pngError) {
              safeDeleteDirectory(
                loProfile
              );

              return res.status(500).json({
                error:
                  'PDF to PNG conversion failed',
                message:
                  pngError.message,
                stdout:
                  pngStdout || '',
                stderr:
                  pngStderr || ''
              });
            }

            // ------------------------------------------------
            // READ GENERATED PNGS
            // ------------------------------------------------

            let files = [];

            try {
              files =
                fs
                  .readdirSync(
                    outDir
                  )
                  .filter(
                    (file) =>
                      /^slide-\d+\.png$/i.test(
                        file
                      )
                  )
                  .sort(
                    (a, b) => {
                      const numA =
                        parseInt(
                          a.match(
                            /\d+/
                          )[0],
                          10
                        );

                      const numB =
                        parseInt(
                          b.match(
                            /\d+/
                          )[0],
                          10
                        );

                      return (
                        numA -
                        numB
                      );
                    }
                  );
            } catch (error) {
              console.error(
                'Could not read generated PNG files:',
                error
              );

              safeDeleteDirectory(
                loProfile
              );

              return res.status(500).json({
                error:
                  'Could not read generated slide images',
                details:
                  error.message
              });
            }

            console.log('');
            console.log(
              '=================================================='
            );
            console.log(
              '             GENERATED SLIDES'
            );
            console.log(
              '=================================================='
            );

            console.log(
              'PNG files:',
              files
            );

            console.log(
              'Slide count:',
              files.length
            );

            console.log(
              '=================================================='
            );

            // ------------------------------------------------
            // NO PNG FILES
            // ------------------------------------------------

            if (
              files.length === 0
            ) {
              safeDeleteDirectory(
                loProfile
              );

              return res.status(500).json({
                error:
                  'Conversion produced no slide images',
                stdout:
                  pngStdout || '',
                stderr:
                  pngStderr || ''
              });
            }

            // ------------------------------------------------
            // CREATE SLIDES JSON
            // ------------------------------------------------

            const slides =
              files.map(
                (file, index) => ({
                  title:
                    `Slide ${index + 1}`,

                  image:
                    `ppt/${presentationId}/${file}`
                })
              );

            const jsonPath =
              path.join(
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
            } catch (error) {
              console.error(
                'Could not write slides JSON:',
                error
              );

              safeDeleteDirectory(
                loProfile
              );

              return res.status(500).json({
                error:
                  'Could not create slide metadata',
                details:
                  error.message
              });
            }

            // ------------------------------------------------
            // CLEAN LIBREOFFICE PROFILE
            // ------------------------------------------------

            safeDeleteDirectory(
              loProfile
            );

            // ------------------------------------------------
            // SUCCESS
            // ------------------------------------------------

            console.log('');
            console.log(
              '=================================================='
            );
            console.log(
              '          PPT CONVERSION SUCCESSFUL'
            );
            console.log(
              '=================================================='
            );

            console.log(
              'Presentation ID:',
              presentationId
            );

            console.log(
              'Number of slides:',
              files.length
            );

            console.log(
              'JSON path:',
              jsonPath
            );

            console.log(
              '=================================================='
            );

            return res.json({
              presentationId,
              slideCount:
                files.length
            });
          }
        );
      }
    );
  }
);

// ============================================================
// GET SLIDES FOR PPT
// ============================================================

app.get(
  '/api/ppt/slides/:id',
  (req, res) => {
    const id = req.params.id;

    const jsonPath =
      path.join(
        pptDir,
        `${id}-slides.json`
      );

    if (
      !fs.existsSync(
        jsonPath
      )
    ) {
      return res.status(404).json({
        error:
          'Presentation not found'
      });
    }

    try {
      const data =
        fs.readFileSync(
          jsonPath,
          'utf8'
        );

      const slides =
        JSON.parse(data);

      return res.json(
        slides
      );
    } catch (error) {
      console.error(
        'Error reading presentation JSON:',
        error
      );

      return res.status(500).json({
        error:
          'Could not read presentation data',
        details:
          error.message
      });
    }
  }
);

// ============================================================
// PPT CONFIG + QR
// ============================================================

app.get(
  '/api/ppt/config/:id',
  async (req, res) => {
    try {
      const id =
        req.params.id;

      const baseURL =
        getBaseURL(req);

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

      return res.json({
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

      return res.status(500).json({
        error:
          'Failed to generate QR'
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
      '           ControlHand PT Server'
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

    // --------------------------------------------------------
    // CHECK LIBREOFFICE AT STARTUP
    // --------------------------------------------------------

    execFile(
      'libreoffice',
      ['--version'],
      {
        timeout: 30000
      },
      (error, stdout, stderr) => {

        if (error) {
          console.error('');
          console.error(
            '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
          );
          console.error(
            'LibreOffice is NOT available.'
          );
          console.error(
            'Make sure the Docker image installs LibreOffice.'
          );
          console.error(
            error.message
          );
          console.error(
            '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
          );
        } else {
          console.log(
            'LibreOffice:',
            (stdout || '').trim()
          );

          if (stderr) {
            console.log(
              'LibreOffice startup stderr:',
              stderr
            );
          }
        }
      }
    );

    // --------------------------------------------------------
    // CHECK PDFTOOL
    // --------------------------------------------------------

    execFile(
      'pdftoppm',
      ['-v'],
      {
        timeout: 30000
      },
      (error, stdout, stderr) => {

        if (error) {
          console.error('');
          console.error(
            '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
          );
          console.error(
            'pdftoppm is NOT available.'
          );
          console.error(
            'Install poppler-utils in Docker.'
          );
          console.error(
            error.message
          );
          console.error(
            '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
          );
        } else {
          console.log(
            'pdftoppm is available.'
          );

          if (stderr) {
            console.log(
              'pdftoppm version:',
              stderr.split('\n')[0]
            );
          }
        }
      }
    );
  }
);
