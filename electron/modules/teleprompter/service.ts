import { BrowserWindow, screen } from 'electron';
import { pinWindowToAllWorkspaces } from '../../lib/workspace-pin';

let teleprompterWindow: BrowserWindow | null = null;

function isAlive(): boolean {
  return teleprompterWindow !== null && !teleprompterWindow.isDestroyed();
}

type Callbacks = {
  onReady?: () => void;
  onClosed?: () => void;
};

export function openTeleprompter(
  preloadPath: string,
  loadURL: (win: BrowserWindow, hash: string) => void,
  { onReady, onClosed }: Callbacks = {},
): void {
  if (isAlive()) {
    teleprompterWindow?.focus();
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: 480,
    height: 320,
    minWidth: 360,
    minHeight: 240,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    hasShadow: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.setPosition(Math.round((width - 480) / 2), Math.round((height - 320) / 2));
  pinWindowToAllWorkspaces(win);
  win.setAlwaysOnTop(true, 'floating');
  win.setContentProtection(true);

  loadURL(win, 'teleprompter');

  win.webContents.once('did-finish-load', () => onReady?.());

  win.on('closed', () => {
    teleprompterWindow = null;
    onClosed?.();
  });

  teleprompterWindow = win;
}

export function closeTeleprompter(): void {
  if (isAlive()) {
    teleprompterWindow?.close();
  }
}

export function getTeleprompterWindow(): BrowserWindow | null {
  return isAlive() ? teleprompterWindow : null;
}

export function toggleTeleprompter(
  preloadPath: string,
  loadURL: (win: BrowserWindow, hash: string) => void,
  callbacks: Callbacks = {},
): void {
  if (isAlive()) {
    closeTeleprompter();
  } else {
    openTeleprompter(preloadPath, loadURL, callbacks);
  }
}
