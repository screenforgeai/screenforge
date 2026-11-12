import type { RecordingCaptureSource, RecordingResult } from '../../types/index';
import type { KnownBrowser, PageVisit } from '../window-bar';

/** getDisplayMedia's displaySurface for a portal capture, when the platform reports it. */
export function displaySurfaceOf(
  track: MediaStreamTrack | undefined,
): RecordingCaptureSource['displaySurface'] | undefined {
  const surface = (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  return surface === 'browser' || surface === 'window' || surface === 'monitor'
    ? surface
    : undefined;
}

/** Browsers by the names their windows report, most specific first. */
const BROWSER_NAMES: [RegExp, KnownBrowser][] = [
  [/\bedge\b/i, 'edge'],
  [/\bbrave\b/i, 'brave'],
  [/\bopera\b/i, 'opera'],
  [/\barc\b/i, 'arc'],
  [/\bfirefox\b/i, 'firefox'],
  [/\bsafari\b/i, 'safari'],
  [/\bchrom(e|ium)\b/i, 'chrome'],
];

/** The browser a recorded window belongs to, from its app name or title; null for any other app. */
export function knownBrowserOf(
  source: Pick<RecordingCaptureSource, 'appName' | 'windowTitle'> | undefined,
): KnownBrowser | null {
  for (const text of [source?.appName, source?.windowTitle]) {
    if (!text) {
      continue;
    }
    const match = BROWSER_NAMES.find(([pattern]) => pattern.test(text));
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * The page's own title from a browser window's title, without the browser's
 * name ("Q3 launch – Acme - Google Chrome" → "Q3 launch – Acme"). Other apps'
 * titles come back as they are.
 */
export function pageTitleFromWindowTitle(windowTitle: string, appName?: string): string {
  let title = windowTitle.trim();
  const names = [
    appName,
    'Google Chrome',
    'Chromium',
    'Microsoft Edge',
    'Microsoft​ Edge',
    'Mozilla Firefox',
    'Firefox',
    'Brave',
    'Opera',
    'Arc',
    'Safari',
  ].filter((name): name is string => !!name);
  for (const name of names) {
    const suffix = new RegExp(`\\s+[-–—|]\\s+${escapeRegExp(name)}$`, 'i');
    title = title.replace(suffix, '');
  }
  // Chrome adds " - Profile name" before its own name in some setups; leave that be.
  return title.trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const pageVisitCache = new WeakMap<RecordingResult, PageVisit[]>();

/**
 * What a recording's window bar can say about its page: Screenforge reads
 * the window's title when recording starts, but not its address (reading
 * that from the recorded toolbar is planned), so this is one page with a
 * title and no URL. Empty for a screen or area recording.
 */
export function recordingPageVisits(result: RecordingResult | null | undefined): PageVisit[] {
  if (!result) {
    return [];
  }
  const cached = pageVisitCache.get(result);
  if (cached) {
    return cached;
  }
  const source = result.captureSource;
  const title =
    source?.kind === 'window' && source.windowTitle
      ? pageTitleFromWindowTitle(source.windowTitle, source.appName)
      : '';
  const visits: PageVisit[] = title ? [{ t: 0, url: '', title }] : [];
  pageVisitCache.set(result, visits);
  return visits;
}

/** What the bar's text starts as when nothing better is known: a placeholder address to replace. */
export const WINDOW_BAR_PLACEHOLDER_TEXT = 'yourproduct.com';

/**
 * The text a window bar starts with when it's switched on: the recorded
 * window's page title when Screenforge read one, else a placeholder address
 * the person types over.
 */
export function windowBarStartText(result: RecordingResult | null | undefined): string {
  return recordingPageVisits(result)[0]?.title || WINDOW_BAR_PLACEHOLDER_TEXT;
}
