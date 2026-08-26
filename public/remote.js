// Mobile Remote Control Logic
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const statusDot = document.getElementById('remote-status-dot');
  const slideNumDisplay = document.getElementById('remote-slide-num');
  const notesContainer = document.getElementById('notes-container');
  const slideSelect = document.getElementById('slide-jump-select');
  
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  
  const tabNotes = document.getElementById('tab-notes');
  const tabPointer = document.getElementById('tab-pointer');
  const notesView = document.getElementById('notes-view');
  const pointerView = document.getElementById('pointer-view');
  
  const timerDisplay = document.getElementById('timer-display');
  const timerToggleBtn = document.getElementById('timer-toggle-btn');
  const timerResetBtn = document.getElementById('timer-reset-btn');
  
  const touchpad = document.getElementById('touchpad');
  const touchCursor = document.getElementById('touch-cursor');
  const laserToggleBtn = document.getElementById('laser-toggle-btn');

  // State Variables
  let slides = [];
  let currentSlideIndex = 0;
  let socket = null;
  let isLaserArmed = true; // By default laser is armed to show when dragging
  let isLaserActive = false;

  // Timer Variables
  let timerInterval = null;
  let timerSeconds = 0;
  let isTimerRunning = false;

  // Touch Swipe Variables
  let touchStartX = 0;
  let touchStartY = 0;
  const swipeMinDistance = 60; // minimum distance in pixels for swipe

  // Initialize Socket Connection
  function initSocket() {
    socket = io();

    socket.on('connect', () => {
      console.log('Connected to Server');
      statusDot.className = 'w-3 h-3 rounded-full bg-green-500';
      
      // Request initial presentation state
      socket.emit('request-sync');
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from Server');
      statusDot.className = 'w-3 h-3 rounded-full bg-red-500';
    });

    socket.on('state-update', (data) => {
      if (data.currentSlideIndex !== undefined) {
        currentSlideIndex = data.currentSlideIndex;
      }
      updateUI();
    });
  }

  // Check if we're in PPT mode (URL has ?ppt=<id>)
  const urlParams = new URLSearchParams(window.location.search);
  const pptId = urlParams.get('ppt');

  // Load Slide Data
  async function loadSlides() {
    try {
      const endpoint = pptId ? `/api/ppt/slides/${pptId}` : '/api/slides';
      const res = await fetch(endpoint);
      slides = await res.json();
      populateSlideSelect();
      updateUI();
    } catch (err) {
      console.error('Failed to load slides:', err);
      notesContainer.textContent = 'Error loading presentation slides.';
    }
  }

  // Populate Dropdown selector
  function populateSlideSelect() {
    slideSelect.innerHTML = '<option value="">Choose a slide...</option>';
    slides.forEach((slide, idx) => {
      const option = document.createElement('option');
      option.value = idx;
      option.textContent = `${idx + 1}. ${slide.title}`;
      slideSelect.appendChild(option);
    });
  }

  // Trigger brief mobile vibration feedback
  function triggerHaptic() {
    if (navigator.vibrate) {
      navigator.vibrate(40); // 40ms vibration
    }
  }

  // Update notes, dropdown, and slide counts
  function updateUI() {
    if (slides.length === 0) return;
    
    // Update count indicator
    slideNumDisplay.textContent = `${currentSlideIndex + 1} / ${slides.length}`;
    
    // Update notes
    const currentSlide = slides[currentSlideIndex];
    if (currentSlide && currentSlide.notes) {
      notesContainer.innerHTML = currentSlide.notes.replace(/\n/g, '<br>');
    } else {
      notesContainer.textContent = 'No speaker notes for this slide.';
    }

    // Keep selector in sync
    slideSelect.value = currentSlideIndex;
  }

  // Touch swiping to navigate slides (specifically on notes card)
  notesContainer.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  notesContainer.addEventListener('touchend', (e) => {
    const endX = e.changedTouches[0].screenX;
    const endY = e.changedTouches[0].screenY;
    
    const diffX = endX - touchStartX;
    const diffY = endY - touchStartY;
    
    // Check if horizontal movement is greater than vertical (to prevent swiping when scrolling notes)
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > swipeMinDistance) {
      if (diffX > 0) {
        // Swipe Right -> Prev
        socket.emit('prev-slide');
        triggerHaptic();
      } else {
        // Swipe Left -> Next
        socket.emit('next-slide');
        triggerHaptic();
      }
    }
  }, { passive: true });

  // Navigation Buttons click
  prevBtn.addEventListener('click', () => {
    socket.emit('prev-slide');
    triggerHaptic();
  });

  nextBtn.addEventListener('click', () => {
    socket.emit('next-slide');
    triggerHaptic();
  });

  slideSelect.addEventListener('change', (e) => {
    const targetIdx = parseInt(e.target.value, 10);
    if (!isNaN(targetIdx)) {
      socket.emit('goto-slide', targetIdx);
      triggerHaptic();
    }
  });

  // Tab Swapping
  tabNotes.addEventListener('click', () => {
    tabNotes.className = 'py-2.5 text-sm font-semibold rounded-xl bg-indigo-600 text-white flex items-center justify-center gap-1.5 transition duration-150';
    tabPointer.className = 'py-2.5 text-sm font-semibold rounded-xl text-slate-400 flex items-center justify-center gap-1.5 transition duration-150';
    notesView.classList.remove('hidden');
    pointerView.classList.add('hidden');
  });

  tabPointer.addEventListener('click', () => {
    tabPointer.className = 'py-2.5 text-sm font-semibold rounded-xl bg-indigo-600 text-white flex items-center justify-center gap-1.5 transition duration-150';
    tabNotes.className = 'py-2.5 text-sm font-semibold rounded-xl text-slate-400 flex items-center justify-center gap-1.5 transition duration-150';
    pointerView.classList.remove('hidden');
    notesView.classList.add('hidden');
  });

  // Presentation Timer logic
  function startTimer() {
    if (isTimerRunning) return;
    isTimerRunning = true;
    timerToggleBtn.querySelector('.material-symbols-outlined').textContent = 'pause';
    timerInterval = setInterval(() => {
      timerSeconds++;
      const mins = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
      const secs = (timerSeconds % 60).toString().padStart(2, '0');
      timerDisplay.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function pauseTimer() {
    if (!isTimerRunning) return;
    isTimerRunning = false;
    timerToggleBtn.querySelector('.material-symbols-outlined').textContent = 'play_arrow';
    clearInterval(timerInterval);
  }

  function resetTimer() {
    pauseTimer();
    timerSeconds = 0;
    timerDisplay.textContent = '00:00';
  }

  timerToggleBtn.addEventListener('click', () => {
    if (isTimerRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
    triggerHaptic();
  });

  timerResetBtn.addEventListener('click', () => {
    resetTimer();
    triggerHaptic();
  });

  // Start timer automatically when page loads
  startTimer();

  // Laser Pointer Touchpad logic
  laserToggleBtn.addEventListener('click', () => {
    isLaserArmed = !isLaserArmed;
    if (isLaserArmed) {
      laserToggleBtn.className = 'px-3 py-1 bg-red-600/10 text-red-400 border border-red-500/30 rounded-full text-xs font-bold hover:bg-red-600/20 flex items-center gap-1 transition';
      laserToggleBtn.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>Laser On';
      touchpad.querySelector('p').textContent = 'Drag finger here to point';
    } else {
      laserToggleBtn.className = 'px-3 py-1 bg-slate-800 text-slate-400 border border-slate-700 rounded-full text-xs font-bold hover:bg-slate-700 flex items-center gap-1 transition';
      laserToggleBtn.innerHTML = '<span class="w-2 h-2 rounded-full bg-slate-600"></span>Laser Off';
      touchpad.querySelector('p').textContent = 'Laser pointer disabled';
      
      // If laser was active, shut it down
      if (isLaserActive) {
        socket.emit('laser-toggle', false);
        isLaserActive = false;
      }
    }
    triggerHaptic();
  });

  // Track Touch Events on Touchpad
  let touchpadRect = null;
  let lastEmitTime = 0;
  const throttleMs = 20; // Send updates at max ~50fps to maintain smooth performance

  function updateTouchpadRect() {
    touchpadRect = touchpad.getBoundingClientRect();
  }

  // Recalculate dimensions on window resize or rotation
  window.addEventListener('resize', updateTouchpadRect);
  window.addEventListener('orientationchange', updateTouchpadRect);

  touchpad.addEventListener('touchstart', (e) => {
    if (!isLaserArmed) return;
    
    updateTouchpadRect();
    isLaserActive = true;
    socket.emit('laser-toggle', true);
    
    handleTouchMove(e);
  }, { passive: false });

  touchpad.addEventListener('touchmove', (e) => {
    if (!isLaserArmed || !isLaserActive) return;
    
    // Prevent mobile bouncing/scrolling
    e.preventDefault();
    handleTouchMove(e);
  }, { passive: false });

  touchpad.addEventListener('touchend', (e) => {
    if (!isLaserActive) return;
    
    isLaserActive = false;
    socket.emit('laser-toggle', false);
    touchCursor.style.opacity = '0';
  }, { passive: true });

  touchpad.addEventListener('touchcancel', () => {
    if (!isLaserActive) return;
    
    isLaserActive = false;
    socket.emit('laser-toggle', false);
    touchCursor.style.opacity = '0';
  }, { passive: true });

  function handleTouchMove(e) {
    if (!touchpadRect || e.touches.length === 0) return;
    
    const touch = e.touches[0];
    
    // Calculate position relative to touchpad element
    const relativeX = touch.clientX - touchpadRect.left;
    const relativeY = touch.clientY - touchpadRect.top;
    
    // Convert to percentage (value between 0.0 and 1.0)
    let percentageX = relativeX / touchpadRect.width;
    let percentageY = relativeY / touchpadRect.height;
    
    // Clamp values between 0 and 1
    percentageX = Math.max(0, Math.min(1, percentageX));
    percentageY = Math.max(0, Math.min(1, percentageY));
    
    // Update local cursor visual representation in touchpad
    touchCursor.style.left = `${percentageX * 100}%`;
    touchCursor.style.top = `${percentageY * 100}%`;
    touchCursor.style.opacity = '1';

    // Throttled emitting coordinates to WebSocket
    const now = Date.now();
    if (now - lastEmitTime >= throttleMs) {
      socket.emit('laser-move', { x: percentageX, y: percentageY });
      lastEmitTime = now;
    }
  }

  // Init setups
  loadSlides();
  initSocket();
  
  // Set default laser armed message
  laserToggleBtn.innerHTML = '<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>Laser On';
  touchpad.querySelector('p').textContent = 'Drag finger here to point';
});
