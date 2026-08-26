// Desktop Presentation App Logic
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const landingScreen = document.getElementById('landing-screen');
  const presentationScreen = document.getElementById('presentation-screen');
  const qrCodeImg = document.getElementById('qr-code-img');
  const qrSpinner = document.getElementById('qr-spinner');
  const remoteLink = document.getElementById('remote-link');
  const startBtn = document.getElementById('start-btn');
  
  const currentSlideContainer = document.getElementById('current-slide-container');
  const hudSlideIndex = document.getElementById('hud-slide-index');
  const hudPrevBtn = document.getElementById('hud-prev-btn');
  const hudNextBtn = document.getElementById('hud-next-btn');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const exitBtn = document.getElementById('exit-btn');
  
  const statusDot = document.getElementById('connection-status-dot');
  const statusText = document.getElementById('connection-status-text');
  const laserPointer = document.getElementById('laser-pointer');

  // Tab elements
  const tabJson = document.getElementById('tab-json');
  const tabPpt = document.getElementById('tab-ppt');
  const jsonContent = document.getElementById('json-content');
  const pptContent = document.getElementById('ppt-content');

  // PowerPoint elements
  const pptDropZone = document.getElementById('ppt-drop-zone');
  const pptFileInput = document.getElementById('ppt-file-input');
  const pptSelectedFile = document.getElementById('ppt-selected-file');
  const pptFileName = document.getElementById('ppt-file-name');
  const pptClearFileBtn = document.getElementById('ppt-clear-file');
  const pptUploadBtn = document.getElementById('ppt-upload-btn');
  const pptUploadSpinner = document.getElementById('ppt-upload-spinner');
  const pptStatusText = document.getElementById('ppt-status-text');
  const pptErrorMessage = document.getElementById('ppt-error-message');
  const pptErrorText = document.getElementById('ppt-error-text');

  const pptUploadMode = document.getElementById('ppt-upload-mode');
  const pptSuccessMode = document.getElementById('ppt-success-mode');
  const pptSlideCount = document.getElementById('ppt-slide-count');
  const pptRemoteLink = document.getElementById('ppt-remote-link');
  const pptQrCode = document.getElementById('ppt-qr-code');
  const pptResetBtn = document.getElementById('ppt-reset-btn');
  const pptStartBtn = document.getElementById('ppt-start-btn');

  // Tab Switch logic
  tabJson.addEventListener('click', () => {
    tabJson.className = 'py-2.5 text-sm font-semibold rounded-xl bg-indigo-600 text-white flex items-center justify-center gap-1.5 transition';
    tabPpt.className = 'py-2.5 text-sm font-semibold rounded-xl text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1.5 transition';
    jsonContent.classList.remove('hidden');
    pptContent.classList.add('hidden');
  });

  tabPpt.addEventListener('click', () => {
    tabPpt.className = 'py-2.5 text-sm font-semibold rounded-xl bg-indigo-600 text-white flex items-center justify-center gap-1.5 transition';
    tabJson.className = 'py-2.5 text-sm font-semibold rounded-xl text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1.5 transition';
    pptContent.classList.remove('hidden');
    jsonContent.classList.add('hidden');
  });

  // PowerPoint Upload Logic
  let selectedPptFile = null;
  let currentPresentationId = null;

  // Drag and Drop handlers
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    pptDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    pptDropZone.addEventListener(eventName, () => pptDropZone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    pptDropZone.addEventListener(eventName, () => pptDropZone.classList.remove('dragover'), false);
  });

  pptDropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    handlePptFiles(files);
  });

  pptFileInput.addEventListener('change', function() {
    handlePptFiles(this.files);
  });

  function handlePptFiles(files) {
    if (files.length === 0) return;
    const file = files[0];
    const validExtensions = ['.ppt', '.pptx'];
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    
    if (!validExtensions.includes(fileExtension)) {
      showPptError("Invalid file type. Please upload a .ppt or .pptx file.");
      return;
    }

    selectedPptFile = file;
    pptFileName.textContent = file.name;
    pptSelectedFile.classList.remove('hidden');
    pptDropZone.classList.add('hidden');
    hidePptError();
    pptUploadBtn.disabled = false;
  }

  pptClearFileBtn.addEventListener('click', () => {
    resetPptUploadState();
  });

  function resetPptUploadState() {
    selectedPptFile = null;
    pptFileInput.value = '';
    pptSelectedFile.classList.add('hidden');
    pptDropZone.classList.remove('hidden');
    pptUploadBtn.disabled = true;
    hidePptError();
  }

  function showPptError(msg) {
    pptErrorText.textContent = msg;
    pptErrorMessage.classList.remove('hidden');
  }

  function hidePptError() {
    pptErrorMessage.classList.add('hidden');
  }

  pptUploadBtn.disabled = true; // initial state

  // Upload PPT logic
  pptUploadBtn.addEventListener('click', async () => {
    if (!selectedPptFile) return;

    pptUploadBtn.disabled = true;
    pptUploadSpinner.classList.remove('hidden');
    pptStatusText.classList.remove('hidden');
    hidePptError();

    const formData = new FormData();
    formData.append('ppt', selectedPptFile);

    try {
      const response = await fetch('/api/ppt/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || 'Upload failed');
      }

      const data = await response.json();
      currentPresentationId = data.presentationId;
      const slideCount = data.slideCount;

      pptStatusText.textContent = "Fetching presentation details...";
      const configRes = await fetch(`/api/ppt/config/${currentPresentationId}`);
      if (!configRes.ok) {
        throw new Error('Failed to retrieve presentation configuration');
      }
      const configData = await configRes.json();

      // Update success UI
      pptSlideCount.textContent = `${slideCount} slide${slideCount !== 1 ? 's' : ''} processed successfully.`;
      pptQrCode.src = configData.qrCodeDataUrl;
      pptRemoteLink.href = configData.phoneRemoteURL;
      pptRemoteLink.textContent = configData.phoneRemoteURL;

      pptUploadMode.classList.add('hidden');
      pptSuccessMode.classList.remove('hidden');
    } catch (err) {
      console.error('PPT upload/conversion error:', err);
      showPptError(err.message || 'An error occurred during upload. Please try again.');
      pptUploadBtn.disabled = false;
    } finally {
      pptUploadSpinner.classList.add('hidden');
      pptStatusText.classList.add('hidden');
      pptStatusText.textContent = "Converting presentation... Make sure PowerPoint is installed on this PC.";
    }
  });

  pptResetBtn.addEventListener('click', () => {
    pptSuccessMode.classList.add('hidden');
    pptUploadMode.classList.remove('hidden');
    resetPptUploadState();
  });

  pptStartBtn.addEventListener('click', () => {
    if (currentPresentationId) {
      window.location.href = `/ppt-view.html?id=${currentPresentationId}`;
    }
  });

  // Presentation State
  let slides = [];
  let currentSlideIndex = 0;
  let socket = null;

  // Initialize Socket.io Connection
  function initSocket() {
    socket = io();

    socket.on('connect', () => {
      console.log('Connected to Server');
      statusDot.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
      statusText.textContent = 'Connected';
      
      // Let the server know how many slides we have
      if (slides.length > 0) {
        socket.emit('set-total-slides', slides.length);
      }
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from Server');
      statusDot.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
      statusText.textContent = 'Disconnected';
    });

    // Update state when slide changes
    socket.on('state-update', (data) => {
      if (data.currentSlideIndex !== undefined) {
        currentSlideIndex = data.currentSlideIndex;
        renderSlide();
      }
    });

    // Laser Pointer Events
    socket.on('laser-moved', (coords) => {
      // Coords are coordinates between 0 and 1 representing percentages of viewport
      const posX = coords.x * window.innerWidth;
      const posY = coords.y * window.innerHeight;
      
      laserPointer.style.left = `${posX}px`;
      laserPointer.style.top = `${posY}px`;
    });

    socket.on('laser-toggled', (active) => {
      if (active) {
        laserPointer.style.opacity = '1';
      } else {
        laserPointer.style.opacity = '0';
      }
    });
  }

  // Load configuration details (IP, QR Code URL)
  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      
      if (data.qrCodeDataUrl) {
        qrCodeImg.src = data.qrCodeDataUrl;
        qrCodeImg.classList.remove('hidden');
        qrSpinner.classList.add('hidden');
      }
      
      remoteLink.href = data.remoteURL;
      remoteLink.textContent = data.remoteURL;
    } catch (err) {
      console.error('Failed to load server config:', err);
      remoteLink.textContent = 'Error connecting to server configuration';
    }
  }

  // Load slides data
  async function loadSlides() {
    try {
      const res = await fetch('/api/slides');
      slides = await res.json();
      console.log('Loaded slides:', slides);
      
      if (socket && socket.connected) {
        socket.emit('set-total-slides', slides.length);
      }
    } catch (err) {
      console.error('Failed to load slides:', err);
    }
  }

  // Render current slide with clean transitions
  function renderSlide() {
    if (slides.length === 0) return;
    const slide = slides[currentSlideIndex];
    
    // Add brief fade-out transition
    currentSlideContainer.style.opacity = '0';
    
    setTimeout(() => {
      // Build slide content
      let contentHtml = `
        <div class="slide-content active">
          <h1 class="slide-title">${slide.title}</h1>
      `;
      
      if (slide.subtitle) {
        contentHtml += `<h2 class="slide-subtitle">${slide.subtitle}</h2>`;
      }
      
      if (slide.bullets && slide.bullets.length > 0) {
        contentHtml += `<ul class="slide-bullets">`;
        slide.bullets.forEach(bullet => {
          // Render bold markdown syntax manually if present (**text**)
          const formattedBullet = bullet.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
          contentHtml += `<li>${formattedBullet}</li>`;
        });
        contentHtml += `</ul>`;
      }
      
      contentHtml += `</div>`;
      
      currentSlideContainer.innerHTML = contentHtml;
      
      // Update HUD
      hudSlideIndex.textContent = `${currentSlideIndex + 1} / ${slides.length}`;
      
      // Fade back in
      currentSlideContainer.style.opacity = '1';
    }, 200);
  }

  // Keyboard navigation controls
  window.addEventListener('keydown', (e) => {
    if (landingScreen.classList.contains('hidden')) {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        socket.emit('next-slide');
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        socket.emit('prev-slide');
      } else if (e.key === 'Escape') {
        exitPresentation();
      }
    }
  });

  // Action Buttons handlers
  startBtn.addEventListener('click', () => {
    landingScreen.classList.add('hidden');
    presentationScreen.classList.remove('hidden');
    loadSlides().then(() => {
      renderSlide();
    });
  });

  hudPrevBtn.addEventListener('click', () => {
    socket.emit('prev-slide');
  });

  hudNextBtn.addEventListener('click', () => {
    socket.emit('next-slide');
  });

  fullscreenBtn.addEventListener('click', () => {
    toggleFullscreen();
  });

  exitBtn.addEventListener('click', () => {
    exitPresentation();
  });

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error enabling fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }

  function exitPresentation() {
    // If in fullscreen, exit first
    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
    presentationScreen.classList.add('hidden');
    landingScreen.classList.remove('hidden');
  }

  // Setup UI
  loadConfig();
  initSocket();
});
