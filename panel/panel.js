// Panel script: handles UI interactions and messaging with service worker
import { StorageManager } from '../shared/storage.js';
import { MESSAGES } from '../shared/messages.js';
import { getPresetConfig, getAllPresetNames } from '../background/presets.js';

class PanelController {
  constructor() {
    this.textInput = document.getElementById('text-input');
    this.startTypingBtn = document.getElementById('start-typing-btn');
    this.humanizeBtn = document.getElementById('humanize-btn');
    this.speedSlider = document.getElementById('speed-slider');
    this.speedValue = document.getElementById('speed-value');
    this.skipConfirmationCheckbox = document.getElementById('skip-confirmation');
    this.advancedBtn = document.getElementById('advanced-btn');
    this.closeBtn = document.getElementById('close-btn');
    
    this.advancedModal = document.getElementById('advanced-modal');
    this.confirmModal = document.getElementById('confirm-modal');
    this.progressSection = document.getElementById('progress-section');
    
    this.currentSettings = StorageManager.getDefaultSettings();
    this.isTyping = false;
    this.speedMultiplier = 1;
    
    this.init();
  }

  async init() {
    // Load settings from storage
    await this.loadSettings();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Update button states
    this.updateButtonStates();
    
    // Listen for messages from service worker
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
    });
  }

  setupEventListeners() {
    // Text input
    this.textInput.addEventListener('input', () => this.updateButtonStates());
    
    // Speed slider
    this.speedSlider.addEventListener('input', (e) => {
      this.speedMultiplier = parseFloat(e.target.value);
      this.speedValue.textContent = this.speedMultiplier.toFixed(2) + 'x';
    });
    
    // Skip confirmation checkbox
    this.skipConfirmationCheckbox.addEventListener('change', async (e) => {
      this.currentSettings.skipStartConfirmation = e.target.checked;
      await StorageManager.saveSettings(this.currentSettings);
    });
    
    // Start Typing button
    this.startTypingBtn.addEventListener('click', () => this.startTyping());
    
    // Close button
    this.closeBtn.addEventListener('click', () => this.closePanel());
    
    // Advanced settings button
    this.advancedBtn.addEventListener('click', () => this.openAdvancedModal());
    
    // Advanced modal buttons
    document.getElementById('modal-close-btn').addEventListener('click', () => this.closeAdvancedModal());
    document.getElementById('modal-cancel-btn').addEventListener('click', () => this.closeAdvancedModal());
    document.getElementById('modal-save-btn').addEventListener('click', () => this.saveAdvancedSettings());
    
    // Confirm modal cancel
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => this.cancelStartTyping());
    
    // Cancel typing button
    document.getElementById('cancel-btn').addEventListener('click', () => this.cancelTyping());
    
    // Advanced settings form listeners
    this.setupAdvancedFormListeners();
  }

  setupAdvancedFormListeners() {
    const presetSelect = document.getElementById('preset-select');
    const wpmInput = document.getElementById('wpm-input');
    const accuracySlider = document.getElementById('accuracy-slider');
    const correctionSpeedInput = document.getElementById('correction-speed-input');
    const breakFreqSlider = document.getElementById('break-freq-slider');
    const breakMinInput = document.getElementById('break-min-input');
    const breakMaxInput = document.getElementById('break-max-input');
    
    presetSelect.addEventListener('change', (e) => this.loadPreset(e.target.value));
    
    // When any field changes, switch to Custom preset
    const fieldChangeListener = () => {
      if (presetSelect.value !== 'Custom') {
        presetSelect.value = 'Custom';
      }
    };
    
    wpmInput.addEventListener('change', fieldChangeListener);
    accuracySlider.addEventListener('input', fieldChangeListener);
    correctionSpeedInput.addEventListener('change', fieldChangeListener);
    breakFreqSlider.addEventListener('input', fieldChangeListener);
    breakMinInput.addEventListener('change', fieldChangeListener);
    breakMaxInput.addEventListener('change', fieldChangeListener);
    
    // Update value displays
    accuracySlider.addEventListener('input', (e) => {
      document.getElementById('accuracy-value').textContent = e.target.value + '%';
    });
    
    breakFreqSlider.addEventListener('input', (e) => {
      document.getElementById('break-freq-value').textContent = e.target.value + '%';
    });
  }

  async loadSettings() {
    this.currentSettings = await StorageManager.getSettings();
    
    // Apply settings to UI
    this.speedSlider.value = 1; // Speed slider always starts at 1x in main panel
    this.speedValue.textContent = '1.00x';
    this.speedMultiplier = 1;
    
    this.skipConfirmationCheckbox.checked = this.currentSettings.skipStartConfirmation || false;
  }

  updateButtonStates() {
    const hasText = this.textInput.textContent.trim().length > 0;
    this.startTypingBtn.disabled = !hasText;
    this.humanizeBtn.disabled = true; // Always disabled in v1
  }

  loadPreset(presetName) {
    if (presetName === 'Custom') {
      // Don't load, let user edit manually
      return;
    }
    
    const presetConfig = getPresetConfig(presetName);
    document.getElementById('wpm-input').value = presetConfig.wpm;
    document.getElementById('accuracy-slider').value = presetConfig.accuracy;
    document.getElementById('accuracy-value').textContent = presetConfig.accuracy + '%';
    document.getElementById('correction-speed-input').value = presetConfig.correctionSpeed;
    document.getElementById('break-freq-slider').value = presetConfig.breakFrequency;
    document.getElementById('break-freq-value').textContent = presetConfig.breakFrequency + '%';
    document.getElementById('break-min-input').value = presetConfig.breakMin;
    document.getElementById('break-max-input').value = presetConfig.breakMax;
  }

  openAdvancedModal() {
    // Pre-fill with current settings
    const presetSelect = document.getElementById('preset-select');
    presetSelect.value = this.currentSettings.preset || 'Intermediate 12-16 Years Old';
    this.loadPreset(presetSelect.value);
    
    this.advancedModal.style.display = 'flex';
  }

  closeAdvancedModal() {
    this.advancedModal.style.display = 'none';
  }

  async saveAdvancedSettings() {
    const preset = document.getElementById('preset-select').value;
    const wpm = Math.max(15, Math.min(150, parseInt(document.getElementById('wpm-input').value) || 40));
    const accuracy = Math.max(0, Math.min(100, parseInt(document.getElementById('accuracy-slider').value) || 88));
    const correctionSpeed = Math.max(0.1, Math.min(10, parseFloat(document.getElementById('correction-speed-input').value) || 1.0));
    const breakFrequency = Math.max(0, Math.min(100, parseInt(document.getElementById('break-freq-slider').value) || 25));
    const breakMin = Math.max(0.1, Math.min(10, parseFloat(document.getElementById('break-min-input').value) || 1.0));
    const breakMax = Math.max(0.1, Math.min(10, parseFloat(document.getElementById('break-max-input').value) || 2.0));
    
    this.currentSettings = {
      preset,
      wpm,
      accuracy,
      correctionSpeed,
      breakFrequency,
      breakMin,
      breakMax,
      skipStartConfirmation: this.currentSettings.skipStartConfirmation,
    };
    
    await StorageManager.saveSettings(this.currentSettings);
    this.closeAdvancedModal();
  }

  async startTyping() {
    const text = this.textInput.textContent;
    if (!text.trim()) {
      return;
    }
    
    // Apply speed multiplier to WPM
    const adjustedWpm = this.currentSettings.wpm * this.speedMultiplier;
    
    const config = {
      wpm: adjustedWpm,
      accuracy: this.currentSettings.accuracy / 100, // Convert to 0-1
      correctionSpeed: this.currentSettings.correctionSpeed,
      breakFrequency: this.currentSettings.breakFrequency / 100, // Convert to 0-1
      breakMin: this.currentSettings.breakMin,
      breakMax: this.currentSettings.breakMax,
    };
    
    this.isTyping = true;
    
    // Show confirmation modal if needed
    if (!this.currentSettings.skipStartConfirmation) {
      this.showConfirmationModal(text, config);
    } else {
      // Start immediately
      this.sendStartTypingMessage(text, config);
    }
  }

  showConfirmationModal(text, config) {
    this.confirmModal.style.display = 'flex';
    
    let countdown = 5;
    document.getElementById('countdown').textContent = countdown;
    
    const countdownInterval = setInterval(() => {
      countdown--;
      document.getElementById('countdown').textContent = countdown;
      
      if (countdown <= 0) {
        clearInterval(countdownInterval);
        this.confirmModal.style.display = 'none';
        this.sendStartTypingMessage(text, config);
      }
    }, 1000);
    
    // Store for cancel button
    this.currentCountdownInterval = countdownInterval;
    this.confirmationTimeout = setTimeout(() => {
      if (this.confirmModal.style.display === 'flex') {
        clearInterval(countdownInterval);
        this.confirmModal.style.display = 'none';
        this.sendStartTypingMessage(text, config);
      }
    }, 5000);
  }

  cancelStartTyping() {
    if (this.currentCountdownInterval) {
      clearInterval(this.currentCountdownInterval);
    }
    if (this.confirmationTimeout) {
      clearTimeout(this.confirmationTimeout);
    }
    this.confirmModal.style.display = 'none';
    this.isTyping = false;
  }

  async sendStartTypingMessage(text, config) {
    const tab = await this.getCurrentTab();
    if (!tab) {
      alert('Could not find active tab');
      this.isTyping = false;
      return;
    }
    
    // Show progress section
    this.showProgress();
    
    // Send message to service worker
    chrome.runtime.sendMessage({
      action: MESSAGES.START_TYPING,
      text,
      config,
      tabId: tab.id,
    });
  }

  getCurrentTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs[0] || null);
      });
    });
  }

  showProgress() {
    this.progressSection.style.display = 'block';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-chars').textContent = '0';
  }

  hideProgress() {
    this.progressSection.style.display = 'none';
    this.isTyping = false;
  }

  cancelTyping() {
    chrome.runtime.sendMessage({
      action: MESSAGES.CANCEL_TYPING,
    });
    this.hideProgress();
  }

  handleMessage(message, sender, sendResponse) {
    switch (message.action) {
      case MESSAGES.TYPING_PROGRESS:
        this.updateProgress(message.charsTyped, message.totalChars);
        break;
      case MESSAGES.TYPING_COMPLETE:
        this.hideProgress();
        break;
      case MESSAGES.TYPING_ERROR:
        console.error('Typing error:', message.error);
        this.hideProgress();
        break;
    }
  }

  updateProgress(charsTyped, totalChars) {
    const percentage = (charsTyped / totalChars) * 100;
    document.getElementById('progress-fill').style.width = percentage + '%';
    document.getElementById('progress-chars').textContent = charsTyped;
    document.getElementById('progress-total').textContent = totalChars;
  }

  closePanel() {
    // Send message to content script to close panel
    window.parent.postMessage({ type: 'AXIOM_CLOSE_PANEL' }, '*');
  }
}

// Initialize panel controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PanelController();
});
