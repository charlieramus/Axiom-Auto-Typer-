// Content script: injects the floating overlay panel directly into Google Docs
// Self-contained — no ES module imports (content scripts are classic scripts)

(() => {
  // ── Inlined constants ─────────────────────────────────────────────────────
  const MESSAGES = {
    START_TYPING: 'START_TYPING',
    CANCEL_TYPING: 'CANCEL_TYPING',
    TYPING_PROGRESS: 'TYPING_PROGRESS',
    TYPING_COMPLETE: 'TYPING_COMPLETE',
    TYPING_ERROR: 'TYPING_ERROR',
  };

  const STORAGE_KEY = 'axiom_settings';

  function getDefaultSettings() {
    return {
      preset: 'Intermediate 12-16 Years Old',
      wpm: 40,
      accuracy: 88,
      correctionSpeed: 1.0,
      breakFrequency: 25,
      breakMin: 1.0,
      breakMax: 2.0,
      skipStartConfirmation: false,
    };
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      return result[STORAGE_KEY] || getDefaultSettings();
    } catch {
      return getDefaultSettings();
    }
  }

  async function saveSettings(settings) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    } catch (e) {
      console.error('Axiom: failed to save settings', e);
    }
  }

  const PRESETS = {
    'Beginner 12-16 Years Old':    { wpm: 25,  accuracy: 80, correctionSpeed: 2.0, breakFrequency: 40, breakMin: 1.0, breakMax: 4.0 },
    'Intermediate 12-16 Years Old':{ wpm: 40,  accuracy: 88, correctionSpeed: 1.0, breakFrequency: 25, breakMin: 1.0, breakMax: 2.0 },
    'Expert 12-16 Years Old':      { wpm: 65,  accuracy: 95, correctionSpeed: 0.6, breakFrequency: 15, breakMin: 0.5, breakMax: 1.5 },
    'Beginner 17+ Years Old':      { wpm: 35,  accuracy: 85, correctionSpeed: 1.5, breakFrequency: 30, breakMin: 1.0, breakMax: 3.0 },
    'Intermediate 17+ Years Old':  { wpm: 55,  accuracy: 92, correctionSpeed: 0.8, breakFrequency: 20, breakMin: 0.5, breakMax: 2.0 },
    'Expert 17+ Years Old':        { wpm: 80,  accuracy: 97, correctionSpeed: 0.4, breakFrequency: 10, breakMin: 0.5, breakMax: 1.5 },
    'Fast':                        { wpm: 120, accuracy: 99, correctionSpeed: 0.25,breakFrequency: 5,  breakMin: 0.3, breakMax: 0.8 },
  };

  function getPresetConfig(name) {
    return PRESETS[name] || PRESETS['Intermediate 12-16 Years Old'];
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let panelVisible = false;

  // ── HTML templates ────────────────────────────────────────────────────────
  const PANEL_HTML = `
    <div class="axiom-panel">

      <div class="axiom-panel-header">
        <div class="axiom-wordmark">
          <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" style="flex-shrink:0;opacity:0.75">
            <path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 11-6-11-6z"/>
          </svg>
          Axiom
        </div>
        <div class="axiom-header-actions">
          <button id="axiom-close-btn" class="axiom-icon-btn" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="axiom-panel-body">

        <div class="axiom-section">
          <div class="axiom-section-meta">
            <span class="axiom-label-tag">Speed</span>
            <span id="axiom-speed-value" class="axiom-big-value">1.00&#xD7;</span>
          </div>
          <input type="range" id="axiom-speed-slider" min="0.5" max="3" step="0.1" value="1" class="axiom-slider">
          <div class="axiom-slider-hints">
            <span>Slower</span>
            <span>Faster</span>
          </div>
        </div>

        <div class="axiom-rule"></div>

        <div class="axiom-toggle-row">
          <div class="axiom-toggle-info">
            <span class="axiom-toggle-title">Skip confirmation</span>
            <span class="axiom-toggle-sub">Start without the 5 s countdown</span>
          </div>
          <label class="axiom-toggle-switch">
            <input type="checkbox" id="axiom-skip-confirmation">
            <span class="axiom-toggle-slider"></span>
          </label>
        </div>

        <div class="axiom-rule"></div>

        <div class="axiom-section">
          <span class="axiom-label-tag">Text</span>
          <textarea id="axiom-text-input" class="axiom-textarea" placeholder="Paste or type your text here&#x2026;"></textarea>
        </div>

        <div class="axiom-rule"></div>

        <button id="axiom-config-toggle-btn" class="axiom-config-toggle">
          <div class="axiom-config-toggle-left">
            <span class="axiom-toggle-title">Typing settings</span>
            <span id="axiom-preset-label" class="axiom-toggle-sub">Intermediate 12-16 Years Old</span>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" class="axiom-config-chevron">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        <div id="axiom-config-panel" style="display:none;">
          <div class="axiom-setting-group">
            <label for="axiom-preset-select">Preset</label>
            <select id="axiom-preset-select" class="axiom-form-control">
              <option>Beginner 12-16 Years Old</option>
              <option>Intermediate 12-16 Years Old</option>
              <option>Expert 12-16 Years Old</option>
              <option>Beginner 17+ Years Old</option>
              <option>Intermediate 17+ Years Old</option>
              <option>Expert 17+ Years Old</option>
              <option>Fast</option>
              <option>Custom</option>
            </select>
            <div class="axiom-helper-text">Pick a preset, or fine-tune values below and Save to lock in a Custom config.</div>
          </div>
          <div class="axiom-setting-group">
            <label for="axiom-wpm-input">Words per minute</label>
            <input type="number" id="axiom-wpm-input" class="axiom-form-control" min="15" max="150" value="40">
          </div>
          <div class="axiom-setting-group">
            <label for="axiom-accuracy-slider">Accuracy</label>
            <div class="axiom-slider-with-value">
              <input type="range" id="axiom-accuracy-slider" class="axiom-slider" min="0" max="100" step="1" value="88">
              <span class="axiom-value-display" id="axiom-accuracy-value">88%</span>
            </div>
          </div>
          <div class="axiom-setting-group">
            <label for="axiom-correction-speed-input">Correction speed (seconds)</label>
            <input type="number" id="axiom-correction-speed-input" class="axiom-form-control" min="0.1" max="10" step="0.1" value="1.0">
          </div>
          <div class="axiom-setting-group">
            <label for="axiom-break-freq-slider">Break frequency</label>
            <div class="axiom-slider-with-value">
              <input type="range" id="axiom-break-freq-slider" class="axiom-slider" min="0" max="100" step="1" value="25">
              <span class="axiom-value-display" id="axiom-break-freq-value">25%</span>
            </div>
          </div>
          <div class="axiom-setting-group">
            <label>Break durations (seconds)</label>
            <div class="axiom-duration-inputs">
              <div class="axiom-duration-input-group">
                <label for="axiom-break-min-input">Min</label>
                <input type="number" id="axiom-break-min-input" class="axiom-form-control" min="0.1" max="10" step="0.1" value="1.0">
              </div>
              <div class="axiom-duration-input-group">
                <label for="axiom-break-max-input">Max</label>
                <input type="number" id="axiom-break-max-input" class="axiom-form-control" min="0.1" max="10" step="0.1" value="2.0">
              </div>
            </div>
          </div>
          <button id="axiom-modal-save-btn" class="axiom-btn axiom-btn-primary" style="width:100%;margin-top:4px;">Save settings</button>
        </div>

        <button id="axiom-start-typing-btn" class="axiom-start-btn" disabled>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
          </svg>
          Start Typing
        </button>

        <div id="axiom-progress-section" class="axiom-progress-section" style="display:none;">
          <div class="axiom-progress-header">
            <span class="axiom-progress-status">Typing in progress</span>
            <button id="axiom-cancel-btn" class="axiom-btn-cancel">Cancel</button>
          </div>
          <div class="axiom-progress-bar">
            <div class="axiom-progress-fill" id="axiom-progress-fill"></div>
          </div>
          <div class="axiom-progress-info">
            <span id="axiom-progress-chars">0</span> / <span id="axiom-progress-total">0</span> chars
          </div>
        </div>

      </div>
    </div>
  `;

  const ADVANCED_MODAL_HTML = `
    <div id="axiom-advanced-modal" class="axiom-modal" style="display:none;"></div>
  `;

  const CONFIRM_MODAL_HTML = ``;

  // ── Slider fill helper ────────────────────────────────────────────────────
  function updateSliderFill(slider) {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const pct = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, #fa5b1c 0%, #fa5b1c ${pct}%, #e5e7eb ${pct}%, #e5e7eb 100%)`;
  }

  // ── Panel Controller ──────────────────────────────────────────────────────
  class PanelController {
    constructor() {
      this.textInput              = document.getElementById('axiom-text-input');
      this.startTypingBtn         = document.getElementById('axiom-start-typing-btn');
      this.speedSlider            = document.getElementById('axiom-speed-slider');
      this.speedValueEl           = document.getElementById('axiom-speed-value');
      this.skipConfirmCheckbox    = document.getElementById('axiom-skip-confirmation');
      this.advancedBtn            = document.getElementById('axiom-advanced-btn');
      this.closeBtn               = document.getElementById('axiom-close-btn');
      this.advancedModal          = document.getElementById('axiom-advanced-modal');
      this.progressSection        = document.getElementById('axiom-progress-section');

      this.currentSettings        = getDefaultSettings();
      this.isTyping               = false;
      this.speedMultiplier        = 1;

      this.init();
    }

    async init() {
      await this.loadSettings();
      this.setupEventListeners();
      this.updateButtonStates();
      updateSliderFill(this.speedSlider);

      chrome.runtime.onMessage.addListener((msg) => this.handleMessage(msg));
    }

    setupEventListeners() {
      this.textInput.addEventListener('input', () => this.updateButtonStates());

      this.speedSlider.addEventListener('input', (e) => {
        this.speedMultiplier = parseFloat(e.target.value);
        this.speedValueEl.textContent = this.speedMultiplier.toFixed(2) + '×';
        updateSliderFill(e.target);
      });

      this.skipConfirmCheckbox.addEventListener('change', async (e) => {
        this.currentSettings.skipStartConfirmation = e.target.checked;
        await saveSettings(this.currentSettings);
      });

      this.startTypingBtn.addEventListener('click', () => this.startTyping());
      this.closeBtn.addEventListener('click', () => togglePanel(false));
      if (this.advancedBtn) this.advancedBtn.addEventListener('click', () => this.openAdvancedModal());

      const modalCloseBtn  = document.getElementById('axiom-modal-close-btn');
      const modalCancelBtn = document.getElementById('axiom-modal-cancel-btn');
      if (modalCloseBtn)  modalCloseBtn.addEventListener('click',  () => this.closeAdvancedModal());
      if (modalCancelBtn) modalCancelBtn.addEventListener('click', () => this.closeAdvancedModal());
      document.getElementById('axiom-modal-save-btn').addEventListener('click', () => this.saveAdvancedSettings());
      document.getElementById('axiom-cancel-btn').addEventListener('click',    () => this.cancelTyping());

      const configToggleBtn = document.getElementById('axiom-config-toggle-btn');
      const configPanel     = document.getElementById('axiom-config-panel');
      if (configToggleBtn && configPanel) {
        configToggleBtn.addEventListener('click', () => {
          const expanded = configPanel.style.display !== 'none';
          configPanel.style.display = expanded ? 'none' : 'block';
          configToggleBtn.classList.toggle('axiom-expanded', !expanded);
          if (!expanded) {
            updateSliderFill(document.getElementById('axiom-accuracy-slider'));
            updateSliderFill(document.getElementById('axiom-break-freq-slider'));
          }
        });
      }

      this.setupAdvancedFormListeners();
    }

    setupAdvancedFormListeners() {
      const presetSelect    = document.getElementById('axiom-preset-select');
      const accuracySlider  = document.getElementById('axiom-accuracy-slider');
      const breakFreqSlider = document.getElementById('axiom-break-freq-slider');

      presetSelect.addEventListener('change', (e) => this.loadPreset(e.target.value));

      const switchToCustom = () => { if (presetSelect.value !== 'Custom') presetSelect.value = 'Custom'; };

      document.getElementById('axiom-wpm-input').addEventListener('change', switchToCustom);
      accuracySlider.addEventListener('input', switchToCustom);
      document.getElementById('axiom-correction-speed-input').addEventListener('change', switchToCustom);
      breakFreqSlider.addEventListener('input', switchToCustom);
      document.getElementById('axiom-break-min-input').addEventListener('change', switchToCustom);
      document.getElementById('axiom-break-max-input').addEventListener('change', switchToCustom);

      accuracySlider.addEventListener('input', (e) => {
        document.getElementById('axiom-accuracy-value').textContent = e.target.value + '%';
        updateSliderFill(e.target);
      });
      breakFreqSlider.addEventListener('input', (e) => {
        document.getElementById('axiom-break-freq-value').textContent = e.target.value + '%';
        updateSliderFill(e.target);
      });
    }

    async loadSettings() {
      this.currentSettings = await loadSettings();
      this.speedSlider.value = 1;
      this.speedValueEl.textContent = '1.00×';
      this.speedMultiplier = 1;
      this.skipConfirmCheckbox.checked = this.currentSettings.skipStartConfirmation || false;

      const s = this.currentSettings;
      const presetSelect    = document.getElementById('axiom-preset-select');
      const wpmInput        = document.getElementById('axiom-wpm-input');
      const accuracySlider  = document.getElementById('axiom-accuracy-slider');
      const accuracyValue   = document.getElementById('axiom-accuracy-value');
      const corrSpeed       = document.getElementById('axiom-correction-speed-input');
      const breakFreqSlider = document.getElementById('axiom-break-freq-slider');
      const breakFreqValue  = document.getElementById('axiom-break-freq-value');
      const breakMin        = document.getElementById('axiom-break-min-input');
      const breakMax        = document.getElementById('axiom-break-max-input');
      const presetLabel     = document.getElementById('axiom-preset-label');

      if (presetSelect)    presetSelect.value    = s.preset || 'Intermediate 12-16 Years Old';
      if (wpmInput)        wpmInput.value        = s.wpm;
      if (accuracySlider)  { accuracySlider.value = s.accuracy; updateSliderFill(accuracySlider); }
      if (accuracyValue)   accuracyValue.textContent = s.accuracy + '%';
      if (corrSpeed)       corrSpeed.value       = s.correctionSpeed;
      if (breakFreqSlider) { breakFreqSlider.value = s.breakFrequency; updateSliderFill(breakFreqSlider); }
      if (breakFreqValue)  breakFreqValue.textContent = s.breakFrequency + '%';
      if (breakMin)        breakMin.value        = s.breakMin;
      if (breakMax)        breakMax.value        = s.breakMax;
      if (presetLabel)     presetLabel.textContent = s.preset || 'Intermediate 12-16 Years Old';
    }

    updateButtonStates() {
      // PHASE 1 TEST: Always enable button (using hardcoded text)
      this.startTypingBtn.disabled = false;
    }

    loadPreset(name) {
      if (name === 'Custom') return;
      const p = getPresetConfig(name);
      const accuracySlider  = document.getElementById('axiom-accuracy-slider');
      const breakFreqSlider = document.getElementById('axiom-break-freq-slider');

      document.getElementById('axiom-wpm-input').value              = p.wpm;
      accuracySlider.value                                           = p.accuracy;
      document.getElementById('axiom-accuracy-value').textContent   = p.accuracy + '%';
      document.getElementById('axiom-correction-speed-input').value = p.correctionSpeed;
      breakFreqSlider.value                                          = p.breakFrequency;
      document.getElementById('axiom-break-freq-value').textContent = p.breakFrequency + '%';
      document.getElementById('axiom-break-min-input').value        = p.breakMin;
      document.getElementById('axiom-break-max-input').value        = p.breakMax;

      updateSliderFill(accuracySlider);
      updateSliderFill(breakFreqSlider);
    }

    openAdvancedModal() {
      if (!this.advancedModal) return;
      const sel = document.getElementById('axiom-preset-select');
      sel.value = this.currentSettings.preset || 'Intermediate 12-16 Years Old';
      this.loadPreset(sel.value);

      const accuracySlider  = document.getElementById('axiom-accuracy-slider');
      const breakFreqSlider = document.getElementById('axiom-break-freq-slider');
      updateSliderFill(accuracySlider);
      updateSliderFill(breakFreqSlider);

      this.advancedModal.style.display = 'flex';
    }

    closeAdvancedModal() {
      this.advancedModal.style.display = 'none';
    }

    async saveAdvancedSettings() {
      const preset          = document.getElementById('axiom-preset-select').value;
      const wpm             = Math.max(15,  Math.min(150, parseInt(document.getElementById('axiom-wpm-input').value)               || 40));
      const accuracy        = Math.max(0,   Math.min(100, parseInt(document.getElementById('axiom-accuracy-slider').value)         || 88));
      const correctionSpeed = Math.max(0.1, Math.min(10,  parseFloat(document.getElementById('axiom-correction-speed-input').value) || 1.0));
      const breakFrequency  = Math.max(0,   Math.min(100, parseInt(document.getElementById('axiom-break-freq-slider').value)       || 25));
      const breakMin        = Math.max(0.1, Math.min(10,  parseFloat(document.getElementById('axiom-break-min-input').value)       || 1.0));
      const breakMax        = Math.max(0.1, Math.min(10,  parseFloat(document.getElementById('axiom-break-max-input').value)       || 2.0));

      this.currentSettings = {
        preset, wpm, accuracy, correctionSpeed, breakFrequency, breakMin, breakMax,
        skipStartConfirmation: this.currentSettings.skipStartConfirmation,
      };
      await saveSettings(this.currentSettings);
      const presetLabel = document.getElementById('axiom-preset-label');
      if (presetLabel) presetLabel.textContent = this.currentSettings.preset;
      this.closeAdvancedModal();
    }

    async startTyping() {
      // PHASE 1 TEST: Hardcoded test with "hello world" at 60 WPM
      // Ignore all settings for now
      const text = 'hello world';
      const config = {
        wpm: 60,
        accuracy: 1.0,  // No typos for now
        correctionSpeed: 1.0,
        breakFrequency: 0,  // No breaks
        breakMin: 0,
        breakMax: 0,
      };

      console.log('PHASE 1 TEST: Starting typing with hardcoded values', { text, wpm: config.wpm });
      this.isTyping = true;
      this.sendStartTypingMessage(text, config);
    }

    async sendStartTypingMessage(text, config) {
      // Content script sends message to service worker
      // Service worker will use sender.tab.id automatically
      this.showProgress();
      chrome.runtime.sendMessage({ action: MESSAGES.START_TYPING, text, config });
    }

    showProgress() {
      this.progressSection.style.display = 'block';
      document.getElementById('axiom-progress-fill').style.width = '0%';
      document.getElementById('axiom-progress-chars').textContent = '0';
    }

    hideProgress() {
      this.progressSection.style.display = 'none';
      this.isTyping = false;
    }

    cancelTyping() {
      chrome.runtime.sendMessage({ action: MESSAGES.CANCEL_TYPING });
      this.hideProgress();
    }

    handleMessage(msg) {
      switch (msg.action) {
        case MESSAGES.TYPING_PROGRESS:
          this.updateProgress(msg.charsTyped, msg.totalChars);
          break;
        case MESSAGES.TYPING_COMPLETE:
          this.hideProgress();
          break;
        case MESSAGES.TYPING_ERROR:
          console.error('Axiom typing error:', msg.error);
          this.hideProgress();
          break;
      }
    }

    updateProgress(charsTyped, totalChars) {
      const pct = (charsTyped / totalChars) * 100;
      document.getElementById('axiom-progress-fill').style.width = pct + '%';
      document.getElementById('axiom-progress-chars').textContent = charsTyped;
      document.getElementById('axiom-progress-total').textContent = totalChars;
    }
  }

  // ── Toggle (with smooth animation) ───────────────────────────────────────
  function togglePanel(forceState) {
    const container = document.getElementById('axiom-panel-container');
    if (!container) return;
    panelVisible = (forceState !== undefined) ? forceState : !panelVisible;

    if (panelVisible) {
      container.style.display = 'block';
      // Double rAF ensures the display:block paint is flushed before animating
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          container.style.opacity = '1';
          container.style.transform = 'translateY(0)';
          container.style.pointerEvents = 'auto';
        });
      });
    } else {
      container.style.opacity = '0';
      container.style.transform = 'translateY(10px)';
      container.style.pointerEvents = 'none';
      setTimeout(() => {
        if (!panelVisible) container.style.display = 'none';
      }, 220);
    }
  }

  // ── Injection ─────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('axiom-styles')) return;
    const link = document.createElement('link');
    link.id   = 'axiom-styles';
    link.rel  = 'stylesheet';
    link.href = chrome.runtime.getURL('panel/panel.css');
    document.head.appendChild(link);
  }

  function injectPanel() {
    if (document.getElementById('axiom-panel-container')) return;

    const container = document.createElement('div');
    container.id = 'axiom-panel-container';
    container.style.cssText = [
      'position:fixed',
      'bottom:max(80px, 24px + 44px + 20px)',
      'right:max(16px, env(safe-area-inset-right, 0px))',
      'width:min(90vw, 420px)',
      'max-height:min(85vh, 80vh)',
      'z-index:2147483646',
      'display:none',
      'border-radius:12px',
      'box-shadow:0 8px 40px rgba(0,0,0,0.12),0 2px 8px rgba(0,0,0,0.06)',
      'overflow:hidden',
      'opacity:0',
      'transform:translateY(10px)',
      'transition:opacity 0.2s ease,transform 0.2s ease',
      'pointer-events:none',
    ].join(';');
    container.innerHTML = PANEL_HTML;
    document.body.appendChild(container);

    document.body.insertAdjacentHTML('beforeend', ADVANCED_MODAL_HTML);
    document.body.insertAdjacentHTML('beforeend', CONFIRM_MODAL_HTML);

    new PanelController();
  }

  function injectTriggerButton() {
    if (document.getElementById('axiom-trigger-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'axiom-trigger-btn';
    btn.title = 'Axiom AutoTyper';
    btn.style.cssText = [
      'position:fixed',
      'bottom:max(16px, env(safe-area-inset-bottom, 0px))',
      'right:max(16px, env(safe-area-inset-right, 0px))',
      'width:44px',
      'height:44px',
      'border-radius:50%',
      'background:white',
      'border:none',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'box-shadow:0 2px 12px rgba(0,0,0,0.12),0 1px 3px rgba(0,0,0,0.07)',
      'z-index:2147483647',
      'padding:0',
      'transition:box-shadow 0.18s,transform 0.18s',
    ].join(';');

    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="#1a1a1a" width="20" height="20"><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 11-6-11-6z"/></svg>`;

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.06) translateY(-1px)';
      btn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.16),0 2px 6px rgba(0,0,0,0.08)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
      btn.style.boxShadow = '0 2px 12px rgba(0,0,0,0.12),0 1px 3px rgba(0,0,0,0.07)';
    });
    btn.addEventListener('click', () => togglePanel());

    document.body.appendChild(btn);
  }

  // ── Message listener (from service worker) ────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'TOGGLE_PANEL') {
      togglePanel();
      sendResponse({ success: true });
    }
    return true;
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  injectStyles();
  injectPanel();
  injectTriggerButton();
})();
