import { BrowserWindow, screen } from 'electron';
import log from '../../lib/logger';
import { pinWindowToAllWorkspaces } from '../../lib/workspace-pin';

let selectorWindow: BrowserWindow | null = null;
let pendingResolve:
  | ((
      area: { x: number; y: number; width: number; height: number; displayId?: number } | null,
    ) => void)
  | null = null;
let selectionDisplayId: number | null = null;

function isAlive(): boolean {
  return selectorWindow !== null && !selectorWindow.isDestroyed();
}

export function openAreaSelector(
  preloadPath: string,
  loadURL: (win: BrowserWindow, hash: string) => void,
  purpose: 'record' | 'screenshot' = 'record',
): Promise<{ x: number; y: number; width: number; height: number; displayId?: number } | null> {
  if (isAlive()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    pendingResolve = resolve;

    const primaryDisplay = screen.getPrimaryDisplay();
    // The area is in this display's coordinates: keep its id with the area.
    selectionDisplayId = primaryDisplay.id;
    const allDisplays = screen.getAllDisplays();

    log.info('[area-selector] primaryDisplay.bounds', primaryDisplay.bounds);
    log.info('[area-selector] primaryDisplay.workArea', primaryDisplay.workArea);
    log.info('[area-selector] primaryDisplay.scaleFactor', primaryDisplay.scaleFactor);
    log.info(
      '[area-selector] allDisplays',
      allDisplays.map((d) => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor })),
    );

    const { x, y, width, height } = primaryDisplay.bounds;

    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      fullscreen: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        sandbox: false,
      },
    });

    pinWindowToAllWorkspaces(win);
    win.setAlwaysOnTop(true, 'screen-saver');
    // macOS repositions the window after setVisibleOnAllWorkspaces/setAlwaysOnTop.
    // Force it back to the exact display bounds.
    win.setBounds({ x, y, width, height });

    loadURL(win, purpose === 'screenshot' ? 'area-selector-screenshot' : 'area-selector');

    win.once('ready-to-show', () => {
      win.setBounds({ x, y, width, height });
      const actual = win.getBounds();
      const contentSize = win.getContentSize();
      log.info('[area-selector] window.getBounds() after ready', actual);
      log.info('[area-selector] window.getContentSize() after ready', contentSize);
    });

    win.webContents.once('did-finish-load', () => {
      win.setBounds({ x, y, width, height });
      const actual = win.getBounds();
      log.info('[area-selector] window.getBounds() after did-finish-load', actual);
    });

    win.on('closed', () => {
      selectorWindow = null;
      if (pendingResolve) {
        pendingResolve(null);
        pendingResolve = null;
        selectionDisplayId = null;
      }
    });

    selectorWindow = win;
    log.info('[area-selector] BrowserWindow created with bounds', { x, y, width, height });
  });
}

export function confirmAreaSelection(area: {
  x: number;
  y: number;
  width: number;
  height: number;
}): void {
  log.info('[area-selector] confirmed', area);
  if (pendingResolve) {
    pendingResolve(selectionDisplayId === null ? area : { ...area, displayId: selectionDisplayId });
    pendingResolve = null;
    selectionDisplayId = null;
  }
  if (isAlive()) {
    selectorWindow?.close();
  }
}

export function cancelAreaSelection(): void {
  log.info('[area-selector] cancelled');
  if (pendingResolve) {
    pendingResolve(null);
    pendingResolve = null;
    selectionDisplayId = null;
  }
  if (isAlive()) {
    selectorWindow?.close();
  }
}

export function getAreaSelectorWindow(): BrowserWindow | null {
  return isAlive() ? selectorWindow : null;
}
