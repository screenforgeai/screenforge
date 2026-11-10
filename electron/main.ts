import { app, BrowserWindow, desktopCapturer, screen, session, shell } from 'electron';
import started from 'electron-squirrel-startup';
import os from 'node:os';
import path from 'node:path';
import fsSync from 'node:fs';
import { pathToFileURL } from 'node:url';
import { registerProtocols, registerSchemePrivileges } from './protocol';
import { CH } from './channels';
import log, { getLogFilePath } from './lib/logger';
import { installNavigationGuards } from './lib/navigation-guard';
import { pinWindowToAllWorkspaces } from './lib/workspace-pin';
import { registerAppChannels } from './modules/app/channel';
import { runPreloadTasks, requestAccessibilityAccess } from './modules/app/service';
import { initTelemetry, shutdownTelemetry, trackEvent } from './lib/telemetry';
import { registerWindowChannels } from './modules/app/window-controller';
import { resetToolbarMousePassthrough, resetToolbarShapeState } from './modules/app/toolbar-mouse';
import { registerLibraryChannels } from './modules/library/channel';
import { registerSettingsChannels } from './modules/settings/channel';
import { getSettingsSync } from './modules/settings/service';
import { registerWhatsNewChannels } from './modules/whats-new/channel';
import { recordInstallStateAtLaunch } from './modules/whats-new/service';
import { registerPresetsChannels } from './modules/presets/channel';
import { registerRecordingChannels } from './modules/recording/channel';
import {
  isRecordingBusy,
  onRecordingActivityChanged,
  setToolbarWindowTitle,
  setExcludedWindowBoundsProvider,
} from './modules/recording/service';
import { getOverlayWindow } from './modules/scene-overlay/service';
import { getTeleprompterWindow } from './modules/teleprompter/service';
import { registerSourcesChannels } from './modules/sources/channel';
import { requestMacScreenCaptureAccess } from './modules/sources/service';
import { registerExportChannels } from './modules/export/channel';
import {
  isExportBusy,
  onExportActivityChanged,
  setMainWindowForCapture,
} from './modules/export/service';
import { runExportHarness } from './testing/exportHarness';
import { isAllowedRendererPermission } from '../src/lib/electronPermissions';
import { registerUpdaterChannels } from './modules/updater/channel';
import {
  notifyUpdaterActivityChanged,
  startUpdater,
  isQuittingForUpdate,
} from './modules/updater/service';
import { registerFFmpegSetupChannels } from './modules/ffmpeg/setup-channel';
import { registerCaptionsChannels } from './modules/captions/channel';
import { registerTeleprompterChannels } from './modules/teleprompter/channel';
import { registerSceneOverlayChannels } from './modules/scene-overlay/channel';
import { registerCameraPreviewChannels } from './modules/camera-preview/channel';
import { registerAreaSelectorChannels } from './modules/area-selector/channel';
import { registerImportChannels } from './modules/import/channel';
import { registerScreenshotChannels } from './modules/screenshot/channel';
import { pickAndImportVideo } from './modules/import/service';
import { getAreaSelectorWindow } from './modules/area-selector/service';
import { initAppTray, destroyAppTray, setAppTrayRecordingState } from './modules/app/app-tray';

// Before telemetry or anything else writes to userData: tells a fresh
// install apart from an update for the What's new dialog.
recordInstallStateAtLaunch();
log.initialize();
log.info('[app] logger initialized', { logFilePath: getLogFilePath() });
initTelemetry({ enabled: getSettingsSync().telemetryEnabled });

process.on('uncaughtException', (error) => {
  log.error('[app] uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('[app] unhandled rejection', reason);
});

if (started) {
  app.quit();
}

// Disable the GPU shader disk cache on Windows — Electron can fail to move
// the cache when the app runs from a path with restricted permissions (e.g.
// Downloads), which produces "Unable to move the cache: Access is denied"
// errors and can prevent the GPU process from starting correctly.
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
}

// Linux: enable Chromium's PipeWire capturer so screen recording works on
// Wayland sessions (capture goes through xdg-desktop-portal). Harmless no-op
// on X11 sessions and on Electron versions where this is already default-on.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
}

// Must be called before app.ready
registerSchemePrivileges();

// The page every app window loads, and the Origin header it sends: packaged
// file:// pages send the literal "null".
const APP_PAGE_URL =
  MAIN_WINDOW_VITE_DEV_SERVER_URL ||
  pathToFileURL(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)).href;
const APP_ORIGIN = MAIN_WINDOW_VITE_DEV_SERVER_URL
  ? new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL).origin
  : 'null';

app.on('web-contents-created', (_event, contents) => {
  installNavigationGuards(contents, APP_PAGE_URL, (url) => void shell.openExternal(url));
});

const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const APP_ICON_PATH = path.join(app.getAppPath(), 'src/assets/app-icon.png');
const TRAY_ICON_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'tray-icon-dark.png')
  : path.join(app.getAppPath(), 'src/assets/tray-icon-dark.png');
const PACKAGED_EXPORT_HARNESS_REQUEST_PATH = path.join(
  os.tmpdir(),
  'screenforge-packaged-export-harness.json',
);

function getCliArgumentValue(flag: string): string | null {
  for (let index = 0; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === flag) {
      return process.argv[index + 1] ?? null;
    }
    if (arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }

  return null;
}

function readPackagedExportHarnessRequest(): { manifestPath: string; resultPath: string } | null {
  try {
    const raw = fsSync.readFileSync(PACKAGED_EXPORT_HARNESS_REQUEST_PATH, 'utf8');
    const parsed = JSON.parse(raw) as {
      manifestPath?: unknown;
      resultPath?: unknown;
      requestedAt?: unknown;
    };
    const manifestPath =
      typeof parsed.manifestPath === 'string' && parsed.manifestPath.length > 0
        ? parsed.manifestPath
        : null;
    const resultPath =
      typeof parsed.resultPath === 'string' && parsed.resultPath.length > 0
        ? parsed.resultPath
        : null;
    const requestedAt =
      typeof parsed.requestedAt === 'string' && parsed.requestedAt.length > 0
        ? Date.parse(parsed.requestedAt)
        : Number.NaN;

    if (!manifestPath || !resultPath) {
      return null;
    }

    if (Number.isFinite(requestedAt) && Date.now() - requestedAt > 5 * 60 * 1000) {
      return null;
    }

    fsSync.rmSync(PACKAGED_EXPORT_HARNESS_REQUEST_PATH, { force: true });
    return { manifestPath, resultPath };
  } catch {
    return null;
  }
}

function getCommandLineSwitchValue(flag: string): string | null {
  const normalizedFlag = flag.replace(/^--/, '');

  try {
    const value = app.commandLine.getSwitchValue(normalizedFlag);
    if (value) {
      return value;
    }

    if (app.commandLine.hasSwitch(normalizedFlag)) {
      return '';
    }
  } catch {
    // Fall back to argv/env only.
  }

  return null;
}

const PACKAGED_EXPORT_HARNESS_REQUEST = readPackagedExportHarnessRequest();

const EXPORT_HARNESS_MANIFEST =
  process.env.SCREENFORGE_EXPORT_TEST_MANIFEST ??
  getCliArgumentValue('--export-harness-manifest') ??
  getCommandLineSwitchValue('--export-harness-manifest') ??
  PACKAGED_EXPORT_HARNESS_REQUEST?.manifestPath ??
  null;
const EXPORT_HARNESS_RESULT =
  process.env.SCREENFORGE_EXPORT_TEST_RESULT ??
  getCliArgumentValue('--export-harness-result') ??
  getCommandLineSwitchValue('--export-harness-result') ??
  PACKAGED_EXPORT_HARNESS_REQUEST?.resultPath ??
  null;
const IS_EXPORT_HARNESS_MODE = Boolean(EXPORT_HARNESS_MANIFEST && EXPORT_HARNESS_RESULT);

if (IS_EXPORT_HARNESS_MODE && EXPORT_HARNESS_RESULT) {
  try {
    fsSync.mkdirSync(path.dirname(EXPORT_HARNESS_RESULT), { recursive: true });
    fsSync.writeFileSync(
      `${EXPORT_HARNESS_RESULT}.boot`,
      JSON.stringify({
        manifest: EXPORT_HARNESS_MANIFEST,
        pid: process.pid,
      }),
    );
  } catch {
    // Best-effort harness breadcrumb only.
  }
}

let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let toolbarWindow: BrowserWindow | null = null;
let harnessKeepAliveWindow: BrowserWindow | null = null;
let startupCompleted = false;
let resolveStartupCompletion: (() => void) | null = null;

function markStartupComplete(): void {
  if (startupCompleted) {
    return;
  }

  startupCompleted = true;
  resolveStartupCompletion?.();
  resolveStartupCompletion = null;
}

function waitForStartupCompletion(): Promise<void> {
  if (startupCompleted) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    resolveStartupCompletion = resolve;
  });
}

// ── Window helpers ─────────────────────────────────────────────────────────────

function loadURL(win: BrowserWindow, hash?: string): void {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = hash
      ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#${hash}`
      : MAIN_WINDOW_VITE_DEV_SERVER_URL;
    win.loadURL(url);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      hash ? { hash } : undefined,
    );
  }
}

function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 440,
    height: 380,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#050507',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: false,
    },
  });
  loadURL(win, 'splash');
  return win;
}

function createMainWindow(): BrowserWindow {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  const scale = 0.8; // 80% of screen
  const winWidth = Math.floor(width * scale);
  const winHeight = Math.floor(winWidth / 1.6); // keep 16:10

  const win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    show: false,
    icon: APP_ICON_PATH,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: false,
    },
  });
  loadURL(win);
  return win;
}

function createToolbarWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.setPosition(0, 0);
  pinWindowToAllWorkspaces(win);
  // setVisibleOnAllWorkspaces can switch the app into accessory activation policy
  // on macOS 14+, hiding the Dock icon. Re-show it explicitly.
  app.dock?.show();
  win.setAlwaysOnTop(true, 'floating');
  resetToolbarShapeState();
  resetToolbarMousePassthrough(win);
  // Give the toolbar a stable title so the native SCK helper can exclude it by name.
  win.setTitle('ScreenforgeToolbar');

  win.once('ready-to-show', () => {
    // Apply content protection after content is rendered — on Windows, calling
    // setContentProtection before the window is ready can conflict with transparent
    // window DWM composition, causing the toolbar to be invisible.
    win.setContentProtection(true);
    win.show();
    win.focus();
    log.info('[toolbar] ready to show');
  });

  loadURL(win, 'toolbar');
  return win;
}

app.on('ready', async () => {
  registerProtocols([APP_ORIGIN]);

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(isAllowedRendererPermission(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    isAllowedRendererPermission(permission),
  );

  // Linux/Wayland: getDisplayMedia in the toolbar drives screen capture.
  // Requesting a screen source from desktopCapturer triggers the
  // xdg-desktop-portal picker, where the user chooses a screen or window.
  if (process.platform === 'linux') {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (sources.length > 0) {
            callback({ video: sources[0] });
          } else {
            log.warn('[capture] display-media request produced no sources');
            callback({});
          }
        })
        .catch((error) => {
          log.warn('[capture] display-media request failed (portal denied?):', error);
          callback({});
        });
    });
  }

  registerExportChannels(PRELOAD_PATH);

  // For export test runs
  if (IS_EXPORT_HARNESS_MODE && EXPORT_HARNESS_MANIFEST && EXPORT_HARNESS_RESULT) {
    harnessKeepAliveWindow = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        preload: PRELOAD_PATH,
        contextIsolation: true,
        sandbox: false,
      },
    });
    await harnessKeepAliveWindow.loadURL('data:text/html,<html><body></body></html>');

    console.info(
      `[export-harness] starting manifest=${EXPORT_HARNESS_MANIFEST} result=${EXPORT_HARNESS_RESULT}`,
    );
    const exitCode = await runExportHarness(
      PRELOAD_PATH,
      EXPORT_HARNESS_MANIFEST,
      EXPORT_HARNESS_RESULT,
    );
    harnessKeepAliveWindow.destroy();
    harnessKeepAliveWindow = null;
    app.exit(exitCode);
    return;
  }

  splashWindow = createSplashWindow();
  mainWindow = createMainWindow();
  setMainWindowForCapture(mainWindow.webContents);

  // On macOS, closing the window hides it instead of destroying it so the app
  // stays in the Dock and can be re-opened by clicking the Dock icon.
  // app.exit() (used in before-quit) bypasses window close events, so quitting
  // via Cmd+Q still works correctly.
  if (process.platform === 'darwin') {
    mainWindow.on('close', (event) => {
      if (isQuittingForUpdate()) {
        return;
      }
      event.preventDefault();
      mainWindow?.hide();
      app.dock?.show();
    });
  }

  registerSourcesChannels();
  registerRecordingChannels();
  registerLibraryChannels();
  registerSettingsChannels();
  registerWhatsNewChannels();
  registerPresetsChannels();
  registerAppChannels();
  registerFFmpegSetupChannels();
  registerCaptionsChannels();
  registerTeleprompterChannels({
    preloadPath: PRELOAD_PATH,
    loadURL,
    getToolbarWindow: () => toolbarWindow,
  });
  registerCameraPreviewChannels({
    preloadPath: PRELOAD_PATH,
    loadURL,
  });
  registerAreaSelectorChannels(PRELOAD_PATH, loadURL);
  registerImportChannels();
  registerSceneOverlayChannels({
    preloadPath: PRELOAD_PATH,
    loadURL,
    getMainWindow: () => mainWindow,
    getToolbarWindow: () => toolbarWindow,
  });
  registerUpdaterChannels({
    getMainWindow: () => mainWindow,
  });
  registerScreenshotChannels({
    getMainWindow: () => mainWindow,
    getToolbarWindow: () => toolbarWindow,
    setToolbarWindow: (window) => {
      toolbarWindow = window;
    },
  });
  registerWindowChannels({
    getMainWindow: () => mainWindow,
    getToolbarWindow: () => toolbarWindow,
    setToolbarWindow: (window) => {
      toolbarWindow = window;
    },
    createToolbarWindow,
  });
  onRecordingActivityChanged(() => notifyUpdaterActivityChanged());
  onRecordingActivityChanged(() => {
    if (isRecordingBusy()) {
      setAppTrayRecordingState(true, () => {
        toolbarWindow?.webContents.send(CH.recording.STOP_REQUESTED);
      });
    } else {
      setAppTrayRecordingState(false);
    }
  });
  onExportActivityChanged(() => notifyUpdaterActivityChanged());

  await new Promise<void>((resolve) => {
    splashWindow?.webContents.once('did-finish-load', resolve);
  });
  splashWindow.show();

  await runPreloadTasks((progress) => {
    splashWindow?.webContents.send(CH.preload.PROGRESS, progress);
  });

  splashWindow.close();
  splashWindow = null;

  trackEvent('app_launched', { is_packaged: app.isPackaged });

  // Prompt for screen capture and accessibility early so they don't block the user when they click record.
  void requestMacScreenCaptureAccess();
  void requestAccessibilityAccess();

  markStartupComplete();

  await waitForStartupCompletion();

  mainWindow.show();
  mainWindow.focus();
  initAppTray(
    mainWindow,
    TRAY_ICON_PATH,
    () => {
      mainWindow?.hide();
      if (!toolbarWindow) {
        toolbarWindow = createToolbarWindow();
      } else {
        resetToolbarMousePassthrough(toolbarWindow);
        toolbarWindow.show();
        toolbarWindow.focus();
      }
    },
    () => {
      mainWindow?.show();
      mainWindow?.focus();
      app.dock?.show();
      void pickAndImportVideo().then((result) => {
        if (!result) {
          mainWindow?.hide();
          return;
        }
        mainWindow?.webContents.send(CH.import.TRIGGER, result);
      });
    },
  );

  setToolbarWindowTitle('ScreenforgeToolbar');

  // Exclude Screenforge's own overlay windows from click/scroll recording.
  setExcludedWindowBoundsProvider(() => {
    const rects = [];
    const overlay = getOverlayWindow();
    if (overlay) {
      rects.push(overlay.getBounds());
    }
    const tp = getTeleprompterWindow();
    if (tp) {
      rects.push(tp.getBounds());
    }
    const areaSel = getAreaSelectorWindow();
    if (areaSel) {
      rects.push(areaSel.getBounds());
    }
    return rects;
  });

  startUpdater({
    isAppBusy: () => isRecordingBusy() || isExportBusy(),
  });
});

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isQuittingForUpdate()) {
    return;
  }
  event.preventDefault();
  shutdownTelemetry()
    .catch((err) => log.warn('[app] telemetry shutdown error:', err))
    .finally(() => {
      destroyAppTray();
      app.exit(0);
    });
});

app.on('render-process-gone', (_event, webContents, details) => {
  log.error('[app] render process gone', {
    reason: details.reason,
    exitCode: details.exitCode,
    url: webContents.getURL(),
  });
});

app.on('child-process-gone', (_event, details) => {
  log.error('[app] child process gone', details);
});

app.on('activate', () => {
  // Only show the main window after startup has completed to avoid racing
  // with the splash screen flow.
  if (!startupCompleted) {
    return;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
});
