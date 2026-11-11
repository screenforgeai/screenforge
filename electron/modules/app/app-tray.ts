import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import log from '../../lib/logger';
import type { RegisteredCaptureShortcuts } from '../../../src/types/index';

export type AppTrayActions = {
  onNewRecording: () => void;
  onTakeScreenshot: () => void;
  onImportVideo: () => void;
  /** Live global capture shortcuts, shown beside their menu items. */
  accelerators: RegisteredCaptureShortcuts;
};

let appTray: Tray | null = null;
let mainWindowRef: BrowserWindow | null = null;
let actionsRef: AppTrayActions | null = null;
let recordingTimer: ReturnType<typeof setInterval> | null = null;
let recordingStart = 0;
let trayIconPath = '';
let idleIcon: Electron.NativeImage | null = null;
let recordingIcon: Electron.NativeImage | null = null;

// Linux status-notifier hosts render tray icons in a square slot and stretch
// non-square pixmaps to fill it; 22px is the conventional panel icon size.
const LINUX_TRAY_ICON_SIZE = 22;

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function showMainWindow(): void {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return;
  }
  mainWindowRef.show();
  mainWindowRef.focus();
  app.dock?.show();
}

/**
 * Shows a global shortcut beside its menu item. registerAccelerator: false
 * keeps the menu from claiming the key itself: the global shortcut owns it.
 */
function shortcutLabel(
  accelerator: string | undefined,
): Partial<Electron.MenuItemConstructorOptions> {
  return accelerator ? { accelerator, registerAccelerator: false } : {};
}

function buildIdleMenu(): Electron.Menu {
  const accelerators = actionsRef?.accelerators ?? {};
  return Menu.buildFromTemplate([
    {
      label: 'New Recording',
      click: () => actionsRef?.onNewRecording(),
      ...shortcutLabel(accelerators.record),
    },
    {
      label: 'Take Screenshot',
      click: () => actionsRef?.onTakeScreenshot(),
      ...shortcutLabel(accelerators.screenshot),
    },
    { label: 'Import Video', click: () => actionsRef?.onImportVideo() },
    { label: 'Open Screenforge', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function buildRecordingMenu(onStop: () => void): Electron.Menu {
  return Menu.buildFromTemplate([
    { label: 'Stop Recording (F9)', click: onStop },
    { type: 'separator' },
    { label: 'New Recording', enabled: false },
    { label: 'Take Screenshot', enabled: false },
    { label: 'Open Screenforge', enabled: false },
    { type: 'separator' },
    { label: 'Quit Screenforge', click: () => app.quit() },
  ]);
}

/**
 * Scales the icon to fit within a size×size box (preserving aspect ratio) and
 * centers it on a transparent square canvas, so square-slot tray hosts don't
 * stretch it.
 */
function padToSquare(icon: Electron.NativeImage, size: number): Electron.NativeImage {
  const { width: srcW, height: srcH } = icon.getSize();
  const scaled = icon.resize(
    srcW >= srcH ? { width: size, quality: 'best' } : { height: size, quality: 'best' },
  );
  const { width, height } = scaled.getSize();
  const src = scaled.toBitmap();
  const out = Buffer.alloc(size * size * 4);
  const offX = Math.floor((size - width) / 2);
  const offY = Math.floor((size - height) / 2);
  for (let y = 0; y < height; y++) {
    src.copy(out, ((y + offY) * size + offX) * 4, y * width * 4, (y + 1) * width * 4);
  }
  return nativeImage.createFromBitmap(out, { width: size, height: size });
}

/** Overlays a filled recording dot (primary accent) in the bottom-right corner. */
function withRecordingDot(icon: Electron.NativeImage): Electron.NativeImage {
  const { width, height } = icon.getSize();
  const data = Buffer.from(icon.toBitmap());
  const r = Math.max(3, Math.round(width * 0.2));
  const cx = width - r - 1;
  const cy = height - r - 1;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r && x >= 0 && y >= 0 && x < width && y < height) {
        const i = (y * width + x) * 4;
        // Raw bitmap is BGRA; primary accent is #d44523 (R=212, G=69, B=35)
        data[i] = 35;
        data[i + 1] = 69;
        data[i + 2] = 212;
        data[i + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBitmap(data, { width, height });
}

function loadIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromPath(trayIconPath);
  if (icon.isEmpty()) {
    log.warn('[app-tray] tray icon not found', { trayIconPath });
    return createFallbackIcon();
  }
  if (process.platform === 'linux') {
    return padToSquare(icon, LINUX_TRAY_ICON_SIZE);
  }
  return icon.resize({ height: 19, quality: 'best' });
}

function createFallbackIcon(): Electron.NativeImage {
  const size = 22;
  const data = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const inside = dx * dx + dy * dy <= r * r;
      const i = (y * size + x) * 4;
      // createFromBitmap expects BGRA on macOS; primary accent is #d44523 (R=212, G=69, B=35)
      data[i] = inside ? 35 : 0;
      data[i + 1] = inside ? 69 : 0;
      data[i + 2] = inside ? 212 : 0;
      data[i + 3] = inside ? 255 : 0;
    }
  }
  return nativeImage.createFromBitmap(data, { width: size, height: size });
}

export function initAppTray(
  mainWindow: BrowserWindow,
  iconPath: string,
  actions: AppTrayActions,
): void {
  if (appTray) {
    return;
  }

  mainWindowRef = mainWindow;
  actionsRef = actions;
  trayIconPath = iconPath;

  try {
    idleIcon = loadIcon();
    appTray = new Tray(idleIcon);
    appTray.setToolTip('Screenforge');
    appTray.setContextMenu(buildIdleMenu());
    // On macOS left-click doesn't open the context menu automatically.
    appTray.on('click', () => appTray?.popUpContextMenu());
    log.info('[app-tray] menu bar icon created');
  } catch (err) {
    log.error('[app-tray] failed to create tray icon', err);
  }
}

export function destroyAppTray(): void {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
  appTray?.destroy();
  appTray = null;
  mainWindowRef = null;
  actionsRef = null;
  idleIcon = null;
  recordingIcon = null;
}

export function setAppTrayRecordingState(isRecording: boolean, onStop?: () => void): void {
  if (!appTray) {
    return;
  }

  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }

  if (isRecording && onStop) {
    recordingStart = Date.now();

    const tick = () => {
      const elapsed = formatElapsed(Date.now() - recordingStart);
      // setTitle is macOS-only. On Linux the tick only refreshes the tooltip:
      // rebuilding the context menu here re-exports the whole DBus menu each
      // second, which makes the open dropdown flicker.
      if (process.platform === 'darwin') {
        appTray?.setTitle(elapsed);
      }
      appTray?.setToolTip(`Screenforge — Recording ${elapsed}`);
    };

    if (process.platform === 'linux' && idleIcon) {
      recordingIcon ??= withRecordingDot(idleIcon);
      appTray.setImage(recordingIcon);
    }
    appTray.setContextMenu(buildRecordingMenu(onStop));
    tick();
    recordingTimer = setInterval(tick, 1000);
  } else {
    if (process.platform === 'linux' && idleIcon) {
      appTray?.setImage(idleIcon);
    }
    appTray?.setTitle('');
    appTray?.setToolTip('Screenforge');
    appTray?.setContextMenu(buildIdleMenu());
  }
}
