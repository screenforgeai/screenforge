import { BrowserWindow, screen } from 'electron';
import { pinWindowToAllWorkspaces } from '../../lib/workspace-pin';

let overlayWindow: BrowserWindow | null = null;

function isAlive(): boolean {
  return overlayWindow !== null && !overlayWindow.isDestroyed();
}

type Callbacks = {
  onReady?: () => void;
  onClosed?: () => void;
};

export function openSceneOverlay(
  preloadPath: string,
  loadURL: (win: BrowserWindow, hash: string) => void,
  { onReady, onClosed }: Callbacks = {},
): void {
  if (isAlive()) {
    overlayWindow?.focus();
    return;
  }

  const { x: displayX, y: displayY } = screen.getPrimaryDisplay().workArea;

  const win = new BrowserWindow({
    width: 300,
    height: 200,
    minWidth: 300,
    minHeight: 48,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.setPosition(displayX + 16, displayY + 16);
  pinWindowToAllWorkspaces(win);
  win.setAlwaysOnTop(true, 'floating');
  win.setContentProtection(true);

  loadURL(win, 'scene-overlay');

  win.webContents.once('did-finish-load', () => onReady?.());

  win.on('closed', () => {
    overlayWindow = null;
    onClosed?.();
  });

  overlayWindow = win;
}

export function closeSceneOverlay(): void {
  if (isAlive()) {
    overlayWindow?.close();
  }
}

export function resizeSceneOverlay(height: number): void {
  if (isAlive()) {
    overlayWindow?.setSize(300, Math.max(48, Math.round(height)));
  }
}

export function getOverlayWindow(): BrowserWindow | null {
  return isAlive() ? overlayWindow : null;
}
