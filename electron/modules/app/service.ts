import { Notification, app, shell, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  PreloadProgress,
  RequestableMediaPermission,
  StartupPermission,
  StartupPermissionMap,
  StartupPermissionStatus,
  WindowFocusTarget,
} from '../../../src/types/index';
import {
  ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE,
  ensureRecordingStartPermissions,
  ensureScreenCapturePermission,
  SCREEN_RECORDING_PERMISSION_RESTART_REQUIRED_MESSAGE,
} from '../../../src/lib/recordingStartPermissions';
import log, { getLogFilePath, writeRendererDiagnostic } from '../../lib/logger';
import { trackEvent } from '../../lib/telemetry';
import { activateX11Window } from '../../lib/x11-activate-window';
import {
  getMacScreenPermissionStatus,
  getSources,
  parseWindowIdFromSourceId,
} from '../sources/service';
import { initializeLibrary } from '../library/service';
import { checkFFmpeg, getFFmpegPath } from '../ffmpeg/index';

let screenSettingsOpened = false;
let accessibilityPromptAttempted = false;
let lastRecordingPermissionPreparationAt = 0;

const RECENT_RECORDING_PERMISSION_PREPARATION_WINDOW_MS = 30_000;

function getAccessibilityPermissionStatus(): StartupPermissionStatus {
  if (process.platform !== 'darwin') {
    // isTrustedAccessibilityClient is macOS-only; other platforms need no
    // accessibility permission for global input hooks.
    return 'granted';
  }
  return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'not-determined';
}

function getMediaStatus(mediaType: 'microphone' | 'camera' | 'screen'): StartupPermissionStatus {
  if (process.platform === 'linux') {
    // getMediaAccessStatus is macOS/Windows-only. On Linux, mic/camera access
    // is mediated by Chromium (and the portal on Wayland) at getUserMedia
    // time, so report granted and let the capture attempt decide.
    return 'granted';
  }

  const status = systemPreferences.getMediaAccessStatus(mediaType);
  if (
    status === 'granted' ||
    status === 'not-determined' ||
    status === 'denied' ||
    status === 'restricted' ||
    status === 'unknown'
  ) {
    return status;
  }
  return 'unknown';
}

export async function runPreloadTasks(onProgress: (p: PreloadProgress) => void): Promise<void> {
  const total = 2;
  let completed = 0;

  const done = (task: string) => {
    completed++;
    onProgress({ task, completed, total });
  };

  await Promise.all([
    checkFFmpeg().then(() => done('FFmpeg Check')),
    initializeLibrary().then(() => done('Library Init')),
  ]);
}

export function writeDiagnosticLog(scope: string, payload?: unknown): void {
  writeRendererDiagnostic(scope, payload);
}

export function getDiagnosticLogFilePath(): string {
  return getLogFilePath();
}

export async function readDiagnosticLog(maxLines = 300): Promise<string> {
  try {
    const content = await fs.readFile(getLogFilePath(), 'utf-8');
    const lines = content.split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

export function showSystemWarning(message: string): void {
  if (!Notification.isSupported()) {
    return;
  }

  new Notification({
    title: 'Screenforge',
    body: message,
  }).show();
}

export function getAppVersion(): string {
  return app.getVersion();
}

export function relaunchApp(): void {
  log.info('[app] relaunch requested');
  app.relaunch();
  app.exit(0);
}

async function getScreenPermissionStatus(): Promise<StartupPermissionStatus> {
  if (process.platform === 'darwin') {
    const status = await getMacScreenPermissionStatus();
    log.info('[startup] screen permission status read', { status });
    return status;
  }

  try {
    const sources = await getSources();
    return sources.length > 0 ? 'granted' : 'unknown';
  } catch (error) {
    log.warn('[startup] could not determine screen permission status:', error);
    return 'unknown';
  }
}

export async function getStartupPermissionStatuses(): Promise<StartupPermissionMap> {
  const screen = await getScreenPermissionStatus();

  // Linux is handled inside getMediaStatus/getAccessibilityPermissionStatus
  // (no systemPreferences APIs exist there).
  const statuses = {
    screen,
    microphone: getMediaStatus('microphone'),
    camera: getMediaStatus('camera'),
    accessibility: getAccessibilityPermissionStatus(),
  };
  log.info('[startup] permission status snapshot', statuses);
  return statuses;
}

export async function requestMediaAccess(
  permission: RequestableMediaPermission,
): Promise<StartupPermissionStatus> {
  if (process.platform !== 'darwin') {
    return getMediaStatus(permission);
  }

  const currentStatus = getMediaStatus(permission);
  log.info('[startup] media permission request', { permission, currentStatus });
  if (currentStatus === 'granted' || currentStatus === 'restricted') {
    return currentStatus;
  }

  if (currentStatus === 'denied') {
    return currentStatus;
  }

  try {
    const granted = await systemPreferences.askForMediaAccess(permission);
    const nextStatus = granted ? 'granted' : getMediaStatus(permission);
    log.info('[startup] media permission request resolved', { permission, nextStatus });
    return nextStatus;
  } catch (error) {
    log.warn(`[startup] could not request ${permission} permission:`, error);
    return getMediaStatus(permission);
  }
}

export async function requestAccessibilityAccess(): Promise<StartupPermissionStatus> {
  if (process.platform !== 'darwin') {
    return getAccessibilityPermissionStatus();
  }

  const currentStatus = getAccessibilityPermissionStatus();
  log.info('[startup] accessibility permission request', { currentStatus });
  if (currentStatus === 'granted') {
    return currentStatus;
  }

  if (accessibilityPromptAttempted) {
    return currentStatus;
  }

  try {
    accessibilityPromptAttempted = true;
    const granted =
      systemPreferences.isTrustedAccessibilityClient(true) ||
      systemPreferences.isTrustedAccessibilityClient(false);
    const nextStatus = granted ? 'granted' : getAccessibilityPermissionStatus();
    log.info('[startup] accessibility permission request resolved', { nextStatus });
    return nextStatus;
  } catch (error) {
    log.warn('[startup] could not request accessibility permission:', error);
    return getAccessibilityPermissionStatus();
  }
}

async function openSystemSettingsForRecordingStart(
  permission: StartupPermission,
): Promise<boolean> {
  if (permission !== 'screen') {
    return false;
  }

  if (screenSettingsOpened) {
    return false;
  }

  screenSettingsOpened = true;
  await openSystemSettings(permission);
  return true;
}

export async function requestScreenAccess(): Promise<StartupPermissionStatus> {
  const currentStatus = await getScreenPermissionStatus();
  log.info('[startup] screen permission request', { currentStatus });
  return currentStatus;
}

export async function prepareRecordingStartPermissions(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  await ensureRecordingStartPermissions({
    requestScreenAccess,
    getAccessibilityPermissionStatus,
    requestAccessibilityAccess,
    openSystemSettings: openSystemSettingsForRecordingStart,
  });

  lastRecordingPermissionPreparationAt = Date.now();
}

/** Screen access only: a screenshot doesn't track the cursor, so no Accessibility prompt. */
export async function prepareScreenshotPermissions(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  await ensureScreenCapturePermission({
    requestScreenAccess,
    openSystemSettings: openSystemSettingsForRecordingStart,
  });
}

async function verifyRecordingStartPermissionsReadOnly(): Promise<void> {
  const screenStatus = await getScreenPermissionStatus();
  if (screenStatus !== 'granted') {
    throw new Error(SCREEN_RECORDING_PERMISSION_RESTART_REQUIRED_MESSAGE);
  }

  const accessibilityStatus = getAccessibilityPermissionStatus();
  if (accessibilityStatus !== 'granted') {
    throw new Error(ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE);
  }
}

export async function prepareRecordingStartPermissionsIfNeeded(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  if (
    lastRecordingPermissionPreparationAt > 0 &&
    Date.now() - lastRecordingPermissionPreparationAt <=
      RECENT_RECORDING_PERMISSION_PREPARATION_WINDOW_MS
  ) {
    return;
  }

  await verifyRecordingStartPermissionsReadOnly();
  lastRecordingPermissionPreparationAt = Date.now();
}

function getSystemSettingsUrl(permission: StartupPermission): string | null {
  if (process.platform === 'darwin') {
    const targets: Record<StartupPermission, string> = {
      screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
      camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
      accessibility:
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    };
    return targets[permission];
  }

  if (process.platform === 'win32') {
    const targets: Record<StartupPermission, string | null> = {
      screen: null,
      microphone: 'ms-settings:privacy-microphone',
      camera: 'ms-settings:privacy-webcam',
      accessibility: null,
    };
    return targets[permission];
  }

  return null;
}

export async function openSystemSettings(permission: StartupPermission): Promise<void> {
  const url = getSystemSettingsUrl(permission);
  if (!url) {
    return;
  }

  log.info('[startup] opening system settings', { permission, url });
  await shell.openExternal(url);
}

export function trackAnalyticsEvent(event: string, properties?: Record<string, unknown>): void {
  trackEvent(event, properties);
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!url.trim()) {
    return;
  }

  await shell.openExternal(url);
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function focusWindow(target: WindowFocusTarget): Promise<void> {
  // Linux X11: sources carry no appName; activate by the X window id embedded
  // in the source id instead (EWMH _NET_ACTIVE_WINDOW).
  if (process.platform === 'linux') {
    const windowId = target.sourceId ? parseWindowIdFromSourceId(target.sourceId) : null;
    if (windowId !== null) {
      await activateX11Window(windowId);
    }
    return;
  }

  const appName = target.appName?.trim();
  const windowTitle = target.windowTitle?.trim();

  if (!appName) {
    return;
  }

  if (process.platform !== 'darwin') {
    return;
  }

  const escapedAppName = escapeAppleScriptString(appName);
  const escapedWindowTitle = windowTitle ? escapeAppleScriptString(windowTitle) : null;
  const script = [
    `tell application "${escapedAppName}" to activate`,
    'try',
    'tell application "System Events"',
    `tell process "${escapedAppName}"`,
    'set frontmost to true',
    ...(escapedWindowTitle
      ? [
          `if exists (first window whose name is "${escapedWindowTitle}") then`,
          `perform action "AXRaise" of first window whose name is "${escapedWindowTitle}"`,
          'end if',
        ]
      : []),
    'end tell',
    'end tell',
    'end try',
  ];

  await new Promise<void>((resolve) => {
    execFile(
      'osascript',
      script.flatMap((line) => ['-e', line]),
      (error) => {
        if (error) {
          log.warn('[app] could not focus selected window:', error);
        }
        resolve();
      },
    );
  });
}

export async function saveScreenshot(dataUrl: string): Promise<string> {
  const picturesPath = app.getPath('pictures');
  const dir = path.join(picturesPath, 'Screenforge');
  await fs.mkdir(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const data = Buffer.from(base64, 'base64');

  // Two saves in the same second (a preview frame, then its annotated copy)
  // must not overwrite each other: 'wx' fails on an existing name, so count up.
  for (let attempt = 0; ; attempt++) {
    const suffix = attempt === 0 ? '' : `-${attempt}`;
    const filePath = path.join(dir, `screenshot-${timestamp}${suffix}.png`);
    try {
      await fs.writeFile(filePath, data, { flag: 'wx' });
      return filePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

export async function saveMusic(
  srcPath: string,
  projectId: string,
): Promise<{ filePath: string; duration: number }> {
  const musicDir = path.join(app.getPath('userData'), 'projects', projectId, 'music');
  await fs.mkdir(musicDir, { recursive: true });

  const ext = path.extname(srcPath);
  const destName = `music-${Date.now()}${ext}`;
  const destPath = path.join(musicDir, destName);
  await fs.copyFile(srcPath, destPath);

  // Probe duration via ffmpeg stderr
  const ffmpegBin = await getFFmpegPath().catch(() => 'ffmpeg');
  const duration = await new Promise<number>((resolve) => {
    execFile(ffmpegBin, ['-i', destPath], (_err, _stdout, stderr) => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (match) {
        resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
      } else {
        resolve(0);
      }
    });
  });

  return { filePath: destPath, duration };
}

export {
  captureException,
  getAnonymousId,
  identifyUser,
  submitFeedback,
} from '../../lib/telemetry';
