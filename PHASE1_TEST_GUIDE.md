# PHASE 1 TEST: Core Typing Verification

## What Was Changed
Modified `content/content.js` → `startTyping()` method to use hardcoded test values:
- **Text**: `"hello world"` (literal)
- **WPM**: `60` (fixed)
- **Accuracy**: `1.0` (no typos)
- **Breaks**: `0` (no pauses)
- **Ignore**: All user settings/presets

## How to Test

### 1. Load the Extension
```
Chrome → Extensions → Manage Extensions
→ Enable "Developer mode" (top right)
→ Click "Load unpacked"
→ Select: c:\Users\jason\Desktop\Mock Folder\Axiom-Auto-Typer\Axiom-Auto-Typer-
```

### 2. Open a Google Docs
```
Go to: https://docs.google.com/document/d/new
(This opens a blank document)
```

### 3. Click the Axiom Extension Icon
- The floating panel should appear in the bottom-right
- **Note**: The "Start Typing" button may appear disabled (it reads from textarea)
- This is OK for now—we're testing the hardcoded path

### 4. Click "Start Typing" Button
- **Expected**: Debugger attaches to the active tab
- **Expected**: `"hello world"` types into the Google Docs automatically
- **Speed**: Should complete in roughly 5-6 seconds (at 60 WPM: ~11 chars)
- **Timing**: 60 WPM = 300 chars/min = 1 char per 200ms

### 5. Check Results
1. **Text appears in Doc?** (Primary check)
2. **Version History shows the text?** (Secondary check)
   - Google Docs → File → Version history
   - Look for a new version showing the typed text

### 6. Check Console Logs
- Open DevTools (F12) → Console tab
- Look for: `"PHASE 1 TEST: Starting typing with hardcoded values..."`
- This confirms the handler was triggered
- Check for any errors from debugger attachment

## Expected Behavior

✅ **Success**:
- Text "hello world" appears in Google Docs
- Text shows in version history
- Typing completes in ~5-6 seconds
- No console errors

❌ **Failure Symptoms**:
- Text doesn't appear → Debugger issue or Input.dispatchKeyEvent not working
- Text appears in wrong place → Focus/click issue
- Typing very slow/fast → Timing calculation issue
- No text in version history → Document not saving properly

## Debugging Steps

If typing doesn't work:

1. **Check Debugger Attachment**:
   - Open `chrome://extensions`
   - Look at error console for the extension
   - Check if debugger protocol version `1.3` is supported

2. **Check Input.dispatchKeyEvent Calls**:
   - Add breakpoint in service-worker.js before `DebuggerHelper.dispatchKeyEvent()`
   - Verify each character is being dispatched

3. **Check Tab Focus**:
   - Ensure Google Docs tab is active
   - Service worker calls `DebuggerHelper.focusTab()` before typing

4. **Check for Permission Issues**:
   - Extension needs `"debugger"` and `"tabs"` permissions
   - Check manifest.json has these

## Next Steps (After Phase 1 Success)
- Implement WPM calculation and inter-keystroke delays
- Add typo/correction logic
- Add break scheduling
- Add user settings integration
- Handle text accuracy settings
