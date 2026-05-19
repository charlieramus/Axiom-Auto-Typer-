// Service worker: manages debugger attachment and typing execution
// Receives commands from the panel and drives the typing engine

import { MESSAGES } from '../shared/messages.js';
import { StorageManager } from '../shared/storage.js';
import { TypingEngine } from './typing-engine.js';

let currentAttachedTabId = null;
let isTyping = false;
let currentCancelFlag = false;

/**
 * Handle action button click: toggle the overlay panel on the active tab
 */
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_PANEL' }, () => {
    chrome.runtime.lastError; // suppress error if content script not ready
  });
});

/**
 * Debugger helper: wraps chrome.debugger API
 */
class DebuggerHelper {
  static async attach(tabId) {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      console.log(`Debugger attached to tab ${tabId}`);
      return true;
    } catch (error) {
      console.error(`Failed to attach debugger: ${error.message}`);
      return false;
    }
  }

  static async detach(tabId) {
    try {
      await chrome.debugger.detach({ tabId });
      console.log(`Debugger detached from tab ${tabId}`);
      return true;
    } catch (error) {
      console.error(`Failed to detach debugger: ${error.message}`);
      return false;
    }
  }

  static async dispatchKeyEvent(tabId, params) {
    try {
      console.log(`[DEBUGGER] Dispatching key event:`, params);
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', params);
    } catch (error) {
      console.error(`Failed to dispatch key event: ${error.message}`, params);
      throw error;
    }
  }

  static async focusTab(tabId) {
    try {
      await chrome.tabs.update(tabId, { active: true });
      console.log(`Focused tab ${tabId}`);
    } catch (error) {
      console.error(`Failed to focus tab: ${error.message}`);
    }
  }
}

/**
 * Convert typing engine action to chrome.debugger.sendCommand params
 */
function actionToDebuggerParams(action) {
  const baseParams = {
    type: action.type === 'keydown' ? 'keyDown' : 'keyUp',
    key: action.key,
    code: action.code,
    windowsVirtualKeyCode: getWindowsVirtualKeyCode(action),
    nativeVirtualKeyCode: getWindowsVirtualKeyCode(action),
  };

  // Add text for keydown events with printable characters
  if (action.type === 'keydown' && action.text) {
    baseParams.text = action.text;
  }

  return baseParams;
}

/**
 * Map key names to Windows virtual key codes
 */
function getWindowsVirtualKeyCode(action) {
  const codeMap = {
    'Backspace': 8,
    'Tab': 9,
    'Enter': 13,
    'Shift': 16,
    'ShiftLeft': 16,
    'ShiftRight': 16,
    ' ': 32,
    'Space': 32,
  };

  if (codeMap[action.key]) {
    return codeMap[action.key];
  }

  if (codeMap[action.code]) {
    return codeMap[action.code];
  }

  // For letters, use ASCII code
  if (action.key && action.key.length === 1) {
    return action.key.toUpperCase().charCodeAt(0);
  }

  return 0;
}

/**
 * Execute the typing sequence
 */
async function executeTyping(tabId, text, config, panelTabId) {
  try {
    console.log('[EXECUTE TYPING] Starting for tab', tabId, 'text length:', text.length);
    isTyping = true;
    currentCancelFlag = false;

    // Attach debugger
    console.log('[EXECUTE TYPING] Attaching debugger to tab', tabId);
    const attached = await DebuggerHelper.attach(tabId);
    if (!attached) {
      throw new Error('Failed to attach debugger');
    }
    console.log('[EXECUTE TYPING] Debugger attached successfully');
    currentAttachedTabId = tabId;

    // Focus the tab
    await DebuggerHelper.focusTab(tabId);

    // Generate typing sequence
    const engine = new TypingEngine(text, {
      wpm: config.wpm,
      accuracy: config.accuracy,
      correctionSpeed: config.correctionSpeed,
      breakFrequency: config.breakFrequency,
      breakMin: config.breakMin,
      breakMax: config.breakMax,
    });

    const actions = engine.generate();
    const totalChars = text.length;
    let typedChars = 0;
    console.log('[EXECUTE TYPING] Generated', actions.length, 'actions for', text.length, 'characters');

    // Execute each action with proper timing
    for (const action of actions) {
      if (currentCancelFlag) {
        break;
      }

      // Wait for the delay
      if (action.delay) {
        await delay(action.delay);
      }

      // For pause actions, just wait
      if (action.type === 'pause') {
        await delay(action.duration);
        continue;
      }

      // Dispatch key event
      try {
        const params = actionToDebuggerParams(action);
        await DebuggerHelper.dispatchKeyEvent(tabId, params);

        // Track progress for keydown events (not shift/modifiers)
        if (action.type === 'keydown' && action.text && action.key !== 'Shift') {
          typedChars++;
        } else if (action.type === 'keydown' && action.key === 'Backspace') {
          typedChars = Math.max(0, typedChars - 1);
        }

        // Send progress update to panel
        chrome.runtime.sendMessage(
          {
            action: MESSAGES.TYPING_PROGRESS,
            charsTyped: typedChars,
            totalChars: totalChars,
            currentAction: action,
          },
          () => {
            // Ignore errors if panel is closed
            chrome.runtime.lastError;
          }
        );
      } catch (error) {
        console.error(`Error dispatching key event:`, error);
        throw error;
      }
    }

    // Typing complete
    console.log('[EXECUTE TYPING] Typing completed successfully');\n    chrome.runtime.sendMessage(
      { action: MESSAGES.TYPING_COMPLETE },
      () => chrome.runtime.lastError
    );

  } catch (error) {
    console.error('[EXECUTE TYPING] ERROR:', error);
    chrome.runtime.sendMessage(
      { action: MESSAGES.TYPING_ERROR, error: error.message },
      () => chrome.runtime.lastError
    );
  } finally {
    console.log('[EXECUTE TYPING] Cleanup: detaching debugger and resetting state');\n    if (currentAttachedTabId) {
      await DebuggerHelper.detach(currentAttachedTabId);
      currentAttachedTabId = null;
    }
    isTyping = false;
    currentCancelFlag = false;
  }
}

/**
 * Helper to delay execution
 */
function delay(ms) {
  return new Promise((resolve) => {
    if (ms > 0) {
      setTimeout(resolve, ms);
    } else {
      resolve();
    }
  });
}

// Handle messages from panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[SERVICE WORKER] Message received:', message.action, 'from tab:', sender.tab.id);
  if (message.action === MESSAGES.START_TYPING) {
    if (isTyping) {
      console.error('[SERVICE WORKER] Already typing, rejecting request');
      sendResponse({ success: false, error: 'Already typing' });
      return true;
    }
    // Use sender.tab.id since content script can't access chrome.tabs API
    const tabId = sender.tab.id;
    if (!tabId) {
      console.error('[SERVICE WORKER] Could not determine tab ID');
      sendResponse({ success: false, error: 'Could not determine tab ID' });
      return true;
    }
    console.log('[SERVICE WORKER] Starting typing on tab', tabId, 'with text:', message.text);
    executeTyping(tabId, message.text, message.config, sender.id);
    sendResponse({ success: true });
  } else if (message.action === MESSAGES.CANCEL_TYPING) {
    console.log('[SERVICE WORKER] Cancel typing received');
    currentCancelFlag = true;
    sendResponse({ success: true });
  }
  return true;
});

// Cleanup on debugger detach (if user cancels via UI)
chrome.debugger.onDetach.addListener((source, reason) => {
  console.log(`Debugger detached from tab ${source.tabId}: ${reason}`);
  currentAttachedTabId = null;
  if (isTyping) {
    isTyping = false;
    currentCancelFlag = true;
  }
});

console.log('Service worker initialized');
