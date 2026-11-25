import { app, desktopCapturer, screen, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { DesktopCapturerSource } from 'electron';
import type { DesktopSource, DisplayInfo, StartupPermissionStatus } from '../../../src/types/index';
import log from '../../lib/logger';
import { shouldUseNativeCapture } from '../../lib/macos-native-capture';
import { isWaylandSession } from '../../lib/linux-capture';

export type MacWindowMetadata = {
  windowID: number;
  appName?: string;
  windowTitle?: string;
  bundleId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  scaleFactor?: number;
};

const WINDOW_LIST_TIMEOUT_MS = 2500;
const SCREEN_ACCESS_CHECK_TIMEOUT_MS = 2500;
const IRRELEVANT_WINDOW_TITLE_PATTERNS = [
  /^gesture overlay$/i,
  /^app icon overlay$/i,
  /^window overlay$/i,
  /^window gesture icon$/i,
  /^window gesture overlay$/i,
  /^screenforgetoolbar$/i,
  // Linux window sources have no appName, so Screenforge's own windows must be
  // excluded by title. Linux-only: macOS/Windows already exclude them via
  // IRRELEVANT_APP_NAME_PATTERNS, and a title-only match could hide a
  // third-party window that happens to be named "Screenforge".
  ...(process.platform === 'linux' ? [/^screenforge$/i] : []),
];
const IRRELEVANT_APP_NAME_PATTERNS = [/^screenforge$/i, /^screenforgecapture$/i];

let cachedSources: DesktopSource[] = [];
// The display each screen source last listed shows. A screen source's id does not name its display
// on every platform (on Windows it is not Electron's display id), but `display_id` does.
const displayIdBySourceId = new Map<string, string>();

export function getNativeHelperPath(): string {
  if (process.platform === 'win32') {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'ScreenforgeCapture.exe');
    }
    return path.join(app.getAppPath(), 'native', 'bin', 'win32-x64', 'ScreenforgeCapture.exe');
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ScreenforgeCapture');
  }
  return path.join(app.getAppPath(), 'native', 'bin', 'ScreenforgeCapture');
}

export function parseWindowIdFromSourceId(sourceId: string): number | null {
  const match = /^window:(\d+)/.exec(sourceId);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getScreenMediaStatus(): StartupPermissionStatus {
  const status = systemPreferences.getMediaAccessStatus('screen');
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

export function parseNativeScreenPermissionStatus(stdout: string): StartupPermissionStatus {
  const normalized = stdout.trim().toLowerCase();
  if (normalized === 'granted') {
    return 'granted';
  }
  if (normalized === 'denied') {
    return 'denied';
  }
  return 'unknown';
}

export async function requestMacScreenCaptureAccess(): Promise<StartupPermissionStatus> {
  if (process.platform === 'win32') {
    return 'granted'; // WGC requires no explicit permission on Windows
  }
  if (process.platform !== 'darwin') {
    return 'unknown';
  }

  // Trigger permission from the main process so the main app bundle (not the
  // helper CLI) gets registered in System Settings > Screen Recording.
  try {
    await desktopCapturer.getSources({ types: ['screen'] });
  } catch {
    // Permission not yet granted — fall through to status check.
  }

  return new Promise((resolve) => {
    execFile(
      getNativeHelperPath(),
      ['--request-screen-access'],
      { timeout: SCREEN_ACCESS_CHECK_TIMEOUT_MS },
      (error, stdout) => {
        if (stdout) {
          const helperStatus = parseNativeScreenPermissionStatus(stdout);
          if (helperStatus !== 'unknown') {
            resolve(helperStatus);
            return;
          }
        }

        if (error) {
          log.warn('[sources] native screen access request failed:', error);
        }

        resolve(getScreenMediaStatus());
      },
    );
  });
}

export async function getMacScreenPermissionStatus(): Promise<StartupPermissionStatus> {
  if (process.platform === 'win32') {
    return 'granted'; // WGC requires no explicit permission on Windows
  }
  if (process.platform !== 'darwin') {
    return 'unknown';
  }

  return new Promise((resolve) => {
    execFile(
      getNativeHelperPath(),
      ['--check-screen-access'],
      { timeout: SCREEN_ACCESS_CHECK_TIMEOUT_MS },
      (error, stdout) => {
        if (stdout) {
          const helperStatus = parseNativeScreenPermissionStatus(stdout);
          if (helperStatus !== 'unknown') {
            resolve(helperStatus);
            return;
          }
        }

        if (error) {
          log.warn('[sources] native screen permission status lookup failed:', error);
        }

        resolve(getScreenMediaStatus());
      },
    );
  });
}

function cleanWindowText(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isIrrelevantWindowSource(source: DesktopSource): boolean {
  const appName = cleanWindowText(source.appName);
  const windowTitle = cleanWindowText(source.windowTitle);
  const rawName = cleanWindowText(source.name);

  if (appName && IRRELEVANT_APP_NAME_PATTERNS.some((pattern) => pattern.test(appName))) {
    return true;
  }

  return [windowTitle, rawName].some((value) =>
    value ? IRRELEVANT_WINDOW_TITLE_PATTERNS.some((pattern) => pattern.test(value)) : false,
  );
}

/** A screen source's display, from what it says it shows. Remembered for the recording. */
function describeScreen(source: DesktopCapturerSource): Pick<DesktopSource, 'displayId'> {
  const displayId = cleanWindowText(source.display_id);
  if (!displayId) {
    return {};
  }
  displayIdBySourceId.set(source.id, displayId);
  return { displayId };
}

/**
 * The attached displays, in the order the OS lists them. Cheap: it captures nothing, so it can be
 * asked whenever the toolbar is shown.
 */
export function getDisplays(): DisplayInfo[] {
  try {
    const primaryId = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display) => ({
      id: display.id,
      label: cleanWindowText(display.label) ?? null,
      width: display.size.width,
      height: display.size.height,
      isPrimary: display.id === primaryId,
    }));
  } catch (error) {
    log.warn('[sources] could not read the displays:', error);
    return [];
  }
}

/**
 * The screen source that shows a display (Electron's `Display.id`), matched by desktopCapturer's
 * `display_id`: the number in a screen source's id is not the display's id on every platform (on
 * Windows it is the screen's position). Null when the screens can't be listed (macOS without
 * Screen Recording, Wayland) or none shows that display.
 */
export async function getScreenSourceForDisplay(displayId: number): Promise<string | null> {
  if (process.platform === 'linux' && isWaylandSession()) {
    return null;
  }
  try {
    if (!(await canListScreens())) {
      return null;
    }
    const rawSources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
    rawSources.forEach((source) => describeScreen(source));
    const match = rawSources.find(
      (source) => cleanWindowText(source.display_id) === String(displayId),
    );
    if (!match) {
      log.warn('[sources] no screen source shows the display:', {
        displayId,
        sources: rawSources.map((source) => ({ id: source.id, displayId: source.display_id })),
      });
    }
    return match?.id ?? null;
  } catch (error) {
    log.warn('[sources] could not list the screens:', error);
    return null;
  }
}

/** The display a screen source shows (Electron's `Display.id`), if it was listed. */
export function getDisplayIdForSource(sourceId: string): string | null {
  return displayIdBySourceId.get(sourceId) ?? null;
}

function toDesktopSource(
  source: DesktopCapturerSource,
  metadataByWindowId: Map<number, MacWindowMetadata>,
): DesktopSource | null {
  const windowId = parseWindowIdFromSourceId(source.id);
  const metadata = windowId !== null ? metadataByWindowId.get(windowId) : undefined;
  const windowTitle = cleanWindowText(metadata?.windowTitle) ?? cleanWindowText(source.name);
  const appName = cleanWindowText(metadata?.appName);

  const desktopSource: DesktopSource = {
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail?.toDataURL() ?? null,
    appIcon: source.appIcon?.toDataURL() ?? null,
    appName,
    windowTitle: source.id.startsWith('window') ? windowTitle : undefined,
    ...(source.id.startsWith('screen:') && describeScreen(source)),
  };

  return isIrrelevantWindowSource(desktopSource) ? null : desktopSource;
}

function parseWindowMetadata(stdout: string): Map<number, MacWindowMetadata> {
  const parsed = JSON.parse(stdout) as { windows?: Record<string, MacWindowMetadata> };
  const entries = Object.entries(parsed.windows ?? {});

  return new Map(
    entries.flatMap(([windowId, metadata]) => {
      const parsedWindowId = Number.parseInt(windowId, 10);
      if (!Number.isFinite(parsedWindowId)) {
        return [];
      }

      return [
        [
          parsedWindowId,
          {
            windowID: parsedWindowId,
            appName: cleanWindowText(metadata?.appName),
            windowTitle: cleanWindowText(metadata?.windowTitle),
            bundleId: cleanWindowText(metadata?.bundleId),
            x: typeof metadata?.x === 'number' ? metadata.x : undefined,
            y: typeof metadata?.y === 'number' ? metadata.y : undefined,
            width: typeof metadata?.width === 'number' ? metadata.width : undefined,
            height: typeof metadata?.height === 'number' ? metadata.height : undefined,
            scaleFactor:
              typeof metadata?.scaleFactor === 'number' ? metadata.scaleFactor : undefined,
          } as MacWindowMetadata,
        ],
      ];
    }),
  );
}

export async function getMacWindowMetadata(): Promise<Map<number, MacWindowMetadata>> {
  if (!shouldUseNativeCapture()) {
    return new Map();
  }

  return new Promise((resolve) => {
    execFile(
      getNativeHelperPath(),
      ['--list-windows'],
      { timeout: WINDOW_LIST_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          log.warn('[sources] native window metadata lookup failed:', error);
          resolve(new Map());
          return;
        }

        try {
          resolve(parseWindowMetadata(stdout));
        } catch (parseError) {
          log.warn('[sources] could not parse native window metadata:', parseError);
          resolve(new Map());
        }
      },
    );
  });
}

const WAYLAND_SCREEN_SOURCE: DesktopSource = {
  id: 'screen:wayland',
  name: 'Entire screen',
  thumbnail: null,
  appIcon: null,
};

async function fetchSources(): Promise<DesktopSource[]> {
  // Wayland: desktopCapturer.getSources() opens the xdg-desktop-portal picker
  // dialog, so enumerating for thumbnails would interrupt the user every
  // refresh. Return a single synthetic display source instead — the real
  // screen/window choice happens in the portal dialog when recording starts.
  if (process.platform === 'linux' && isWaylandSession()) {
    return [WAYLAND_SCREEN_SOURCE];
  }

  if (!(await canListScreens())) {
    log.info('[sources] screen permission missing; returning cached sources only', {
      cachedCount: cachedSources.length,
    });
    return getCachedSources();
  }

  // Linux reaching this point is always X11 (Wayland returned earlier); window
  // sources are capturable there via x11grab + xwininfo geometry.
  const includeWindows = shouldUseNativeCapture() || process.platform === 'linux';

  const [rawSources, metadataByWindowId] = await Promise.all([
    desktopCapturer.getSources({
      types: includeWindows ? ['screen', 'window'] : ['screen'],
      thumbnailSize: { width: 200, height: 120 },
      fetchWindowIcons: true,
    }),
    getMacWindowMetadata(),
  ]);

  return rawSources
    .map((source) => toDesktopSource(source, metadataByWindowId))
    .filter((source): source is DesktopSource => source !== null);
}

/** macOS lists no screens until Screen Recording is allowed; elsewhere they always can be. */
async function canListScreens(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true;
  }
  return (await getMacScreenPermissionStatus()) === 'granted';
}

export async function initializeSources(): Promise<void> {
  try {
    cachedSources = await fetchSources();
  } catch (e) {
    log.warn('desktopCapturer failed:', e);
    cachedSources = [];
  }
}

export const getCachedSources = (): DesktopSource[] => cachedSources;

export async function getSources(): Promise<DesktopSource[]> {
  try {
    const sources = await fetchSources();
    cachedSources = sources;
    return sources;
  } catch {
    return getCachedSources();
  }
}
