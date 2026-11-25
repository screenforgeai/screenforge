import { app, type BrowserWindow } from 'electron';

/**
 * Gives a capture overlay the keyboard, so Esc and Enter reach it. Opened from the menu bar icon
 * or a global shortcut, Screenforge is not the active app and macOS would keep sending keys to
 * whichever app is: the user asked for the capture, so bring Screenforge forward.
 */
export function focusOverlay(win: BrowserWindow): void {
  if (win.isDestroyed()) {
    return;
  }
  if (process.platform === 'darwin') {
    app.focus({ steal: true });
  }
  win.focus();
}
