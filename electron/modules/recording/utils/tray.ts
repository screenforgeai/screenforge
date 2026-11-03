import { globalShortcut, Notification } from 'electron';
import log from '../../../lib/logger';
import { setAppTrayRecordingState } from '../../app/app-tray';

/**
 * Updates the app menu bar icon to recording state and registers the F9
 * global shortcut. `onStop` is called when the user triggers stop via the
 * tray menu or shortcut.
 *
 * globalShortcut is unreliable on Wayland — registration failure must not
 * block recording (the tray menu and the OS screen-share indicator remain
 * as stop affordances).
 */
export function startRecordingTray(onStop: () => void): void {
  setAppTrayRecordingState(true, onStop);
  try {
    if (!globalShortcut.register('F9', onStop)) {
      log.warn('[recording-tray] could not register F9 stop shortcut');
    }
  } catch (err) {
    log.warn('[recording-tray] F9 shortcut registration failed:', err);
  }

  new Notification({
    title: 'Screenforge',
    body: 'Recording started. Press F9 or click the menu bar icon to stop.',
  }).show();
}

/** Resets the app menu bar icon to idle state and unregisters F9. */
export function destroyRecordingTray(): void {
  try {
    globalShortcut.unregister('F9');
  } catch (err) {
    log.warn('[recording-tray] F9 shortcut unregistration failed:', err);
  }
  setAppTrayRecordingState(false);
}
