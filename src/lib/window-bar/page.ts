import { PAGE_CROSSFADE_SECONDS } from './tokens';
import type { PageVisit, WindowBarCenter, WindowBarPage, WindowBarSettings } from './types';

/** "https://www.app.example.com/projects/?tab=1#top" → { host: "app.example.com", address: "app.example.com/projects" }. */
export function splitUrl(url: string): { host: string; address: string } {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol === 'about:' ||
      parsed.protocol === 'data:' ||
      parsed.protocol === 'blob:'
    ) {
      return { host: '', address: '' };
    }
    const host = parsed.host.replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '');
    return { host, address: host + path };
  } catch {
    // Not a full URL (a bare "example.com/x"): drop any scheme, query and hash by hand.
    const bare = url
      .trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .replace(/^www\./, '');
    const slash = bare.indexOf('/');
    return { host: slash === -1 ? bare : bare.slice(0, slash), address: bare };
  }
}

/** What the bar's center (or the Windows title) reads for `page`. */
export function centerText(
  settings: WindowBarSettings,
  page: WindowBarPage | null | undefined,
): string {
  const url = page?.url ? splitUrl(page.url) : null;
  switch (settings.center) {
    case 'url':
      return url?.address ?? '';
    case 'domain':
      return url?.host ?? '';
    case 'title':
      return page?.title?.trim() || url?.host || '';
    case 'custom':
      return settings.customText?.trim() ?? '';
    case 'none':
    default:
      return '';
  }
}

/** The lock shows by itself for an address, never on a Windows bar. */
export function showsLock(
  settings: WindowBarSettings,
  center: WindowBarCenter = settings.center,
): boolean {
  return settings.style !== 'windows' && (center === 'url' || center === 'domain');
}

/** Puts visits in time order and drops a repeat of the page already showing. */
export function normalizePageVisits(visits: PageVisit[] | null | undefined): PageVisit[] {
  const sorted = [...(visits ?? [])]
    .filter((visit) => Number.isFinite(visit.t) && typeof visit.url === 'string')
    .sort((a, b) => a.t - b.t);
  const out: PageVisit[] = [];
  for (const visit of sorted) {
    const previous = out[out.length - 1];
    if (previous && previous.url === visit.url && (previous.title ?? '') === (visit.title ?? '')) {
      continue;
    }
    out.push(visit);
  }
  return out;
}

export interface PageAtTime {
  page: WindowBarPage | null;
  /** The page fading out, while the crossfade runs. */
  previous: WindowBarPage | null;
  /** 0 → only `previous`, 1 → only `page`. */
  mix: number;
}

/**
 * The page on screen at `t` seconds, from a normalized visit list. Before
 * the first visit the first page shows (the recording opens on it); a later
 * page fades in over 150ms from the moment it was visited.
 */
export function pageAtTime(
  visits: PageVisit[],
  t: number,
  fadeSeconds: number = PAGE_CROSSFADE_SECONDS,
): PageAtTime {
  let index = -1;
  for (let i = 0; i < visits.length; i++) {
    if (index === -1 || (visits[i]?.t ?? Infinity) <= t) {
      index = i;
    } else {
      break;
    }
  }
  const current = visits[index];
  if (!current) {
    return { page: null, previous: null, mix: 1 };
  }
  const since = t - current.t;
  const previous = visits[index - 1];
  if (!previous || fadeSeconds <= 0 || since >= fadeSeconds) {
    return { page: current, previous: null, mix: 1 };
  }
  return { page: current, previous, mix: Math.max(0, since / fadeSeconds) };
}
