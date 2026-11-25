import { BrowserWindow, screen } from 'electron';
import log from '../../lib/logger';
import { pinWindowToAllWorkspaces } from '../../lib/workspace-pin';
import { focusOverlay } from '../../lib/focus-overlay';
import { getDisplays } from '../sources/service';
import type {
  DisplayInfo,
  DisplayPickerPurpose,
  DisplayPickerTarget,
} from '../../../src/types/index';

type Overlay = { win: BrowserWindow; display: DisplayInfo; number: number };

/** The open overlays, by the id of the page each one shows. */
const overlays = new Map<number, Overlay>();
let pendingResolve: ((displayId: number | null) => void) | null = null;
let pickPurpose: DisplayPickerPurpose = 'record';

function isOpen(): boolean {
  return pendingResolve !== null;
}

function onDisplaysChanged(): void {
  // An overlay would cover a monitor that is gone, or miss a new one: ask again instead.
  log.info('[display-picker] the displays changed while picking; cancelled');
  finish(null);
}

function finish(displayId: number | null): void {
  const resolve = pendingResolve;
  pendingResolve = null;
  screen.removeListener('display-added', onDisplaysChanged);
  screen.removeListener('display-removed', onDisplaysChanged);
  const windows = [...overlays.values()].map((overlay) => overlay.win);
  overlays.clear();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.close();
    }
  }
  resolve?.(displayId);
}

/**
 * macOS may move a window to another screen when it is shown (to the one with the menu bar or
 * the cursor): put it back on its own monitor, and log where it ended up.
 */
function pinToBounds(win: BrowserWindow, display: DisplayInfo, bounds: Electron.Rectangle): void {
  win.setBounds(bounds);
  const actual = win.getBounds();
  const off =
    actual.x !== bounds.x ||
    actual.y !== bounds.y ||
    actual.width !== bounds.width ||
    actual.height !== bounds.height;
  (off ? log.warn : log.info)('[display-picker] overlay bounds', {
    displayId: display.id,
    expected: bounds,
    actual,
  });
}

/**
 * Covers each attached monitor with an overlay to click the one to capture. Resolves with the
 * picked display's id (Electron's `Display.id`), or null when cancelled.
 */
export function openDisplayPicker(
  preloadPath: string,
  loadURL: (win: BrowserWindow, hash: string) => void,
  purpose: DisplayPickerPurpose,
): Promise<number | null> {
  if (isOpen()) {
    return Promise.resolve(null);
  }
  const displays = getDisplays();
  const electronDisplays = screen.getAllDisplays();
  if (displays.length === 0) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    pendingResolve = resolve;
    pickPurpose = purpose;
    screen.on('display-added', onDisplaysChanged);
    screen.on('display-removed', onDisplaysChanged);

    const cursorDisplayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;

    displays.forEach((display, index) => {
      const bounds = electronDisplays.find((candidate) => candidate.id === display.id)?.bounds;
      if (!bounds) {
        return;
      }
      const win = new BrowserWindow({
        ...bounds,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        // Lets the window cover the whole monitor, menu bar and Dock included.
        enableLargerThanScreen: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        hasShadow: false,
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          sandbox: false,
        },
      });
      pinWindowToAllWorkspaces(win);
      win.setAlwaysOnTop(true, 'screen-saver');
      // macOS moves the window after setVisibleOnAllWorkspaces/setAlwaysOnTop: put it back.
      win.setBounds(bounds);

      const webContentsId = win.webContents.id;
      overlays.set(webContentsId, { win, display, number: index + 1 });
      // One of this pick's overlays closed from outside, or its page crashed (the window may stay
      // open, but nothing in it answers clicks or Esc): cancel, and the others go too. Windows
      // close asynchronously, so a closed event can arrive from an earlier pick's overlay after
      // a new pick opened: only this pick's own overlays cancel it.
      const cancelIfCurrent = (reason: string, details?: unknown) => {
        if (overlays.get(webContentsId)?.win !== win) {
          return;
        }
        log.warn('[display-picker] an overlay went away; cancelled', {
          reason,
          displayId: display.id,
          details,
        });
        finish(null);
      };
      win.on('closed', () => cancelIfCurrent('closed'));
      win.webContents.on('render-process-gone', (_event, details) =>
        cancelIfCurrent('render-process-gone', details),
      );
      win.once('ready-to-show', () => {
        // Keys go to the monitor the cursor is on.
        if (display.id === cursorDisplayId) {
          win.show();
          focusOverlay(win);
        } else {
          win.showInactive();
        }
        pinToBounds(win, display, bounds);
      });
      loadURL(win, 'display-picker');
    });

    log.info('[display-picker] opened', {
      displays: displays.map((display) => ({ id: display.id, label: display.label })),
      purpose,
    });
  });
}

/** What the overlay showing this page covers. */
export function getDisplayPickerTarget(webContentsId: number): DisplayPickerTarget | null {
  const overlay = overlays.get(webContentsId);
  if (!overlay) {
    return null;
  }
  return {
    display: overlay.display,
    number: overlay.number,
    count: overlays.size,
    purpose: pickPurpose,
  };
}

/**
 * Picks the monitor of the overlay showing this page, or the one with that number (the number
 * keys pick any monitor from whichever overlay has the keyboard).
 */
export function confirmDisplayPick(webContentsId: number, number?: number): void {
  const overlay =
    number === undefined
      ? overlays.get(webContentsId)
      : [...overlays.values()].find((candidate) => candidate.number === number);
  if (!overlay) {
    return;
  }
  log.info('[display-picker] picked', {
    id: overlay.display.id,
    label: overlay.display.label,
    number: overlay.number,
  });
  finish(overlay.display.id);
}

export function cancelDisplayPick(): void {
  if (!isOpen()) {
    return;
  }
  log.info('[display-picker] cancelled');
  finish(null);
}
