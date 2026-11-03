import type { BrowserWindow } from 'electron';

/**
 * Keeps an overlay window visible on every workspace / virtual desktop.
 *
 * On X11 the sticky state is a request to the window manager that is silently
 * dropped when the window is not yet mapped — and overlay windows here are
 * pinned right after construction, before their first show. Re-asserting from
 * the 'show' event is what actually lands (_NET_WM_STATE_STICKY, verified on
 * Mutter); macOS applies the collection behavior regardless of visibility.
 */
export function pinWindowToAllWorkspaces(win: BrowserWindow): void {
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (process.platform === 'linux') {
    win.on('show', () => {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    });
  }
}
