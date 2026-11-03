import { BrowserWindow, screen } from 'electron';
import { pinWindowToAllWorkspaces } from '../../lib/workspace-pin';

let cameraPreviewWindow: BrowserWindow | null = null;
let pendingDeviceId: string | null = null;

function isAlive(): boolean {
  return cameraPreviewWindow !== null && !cameraPreviewWindow.isDestroyed();
}

export function getPendingCameraDeviceId(): string | null {
  return pendingDeviceId;
}

export function openCameraPreview(
  deviceId: string | null,
  preloadPath: string,
  loadURL: (win: BrowserWindow, hash: string) => void,
): void {
  pendingDeviceId = deviceId;

  if (isAlive()) {
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: 200,
    height: 200,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    hasShadow: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.setPosition(width - 220, height - 260);
  pinWindowToAllWorkspaces(win);
  win.setAlwaysOnTop(true, 'modal-panel');
  win.setContentProtection(true);

  loadURL(win, 'camera-preview');

  win.on('closed', () => {
    cameraPreviewWindow = null;
  });

  cameraPreviewWindow = win;
}

export function closeCameraPreview(): void {
  pendingDeviceId = null;
  if (isAlive()) {
    cameraPreviewWindow!.close();
  }
  cameraPreviewWindow = null;
}
