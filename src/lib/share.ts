import type { ExportFormat, ProjectShareLink } from '../types';

/** Director's share links take mp4 and webm; MOV and GIF can't be shared. */
export const isShareableFormat = (format: ExportFormat): boolean =>
  format === 'mp4' || format === 'webm';

/** "6 Dec", or "5 Jan 2027" when it isn't this year. */
export const formatShareDate = (iso: string, locale: string, now = Date.now()): string => {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
};

export type ShareExpiry =
  | { kind: 'never' }
  | { kind: 'expires'; at: string }
  | { kind: 'expired' }
  | { kind: 'removed' };

export const shareExpiry = (
  link: Pick<ProjectShareLink, 'expiresAt' | 'status'>,
  now = Date.now(),
): ShareExpiry => {
  if (link.status === 'removed') {
    return { kind: 'removed' };
  }
  if (link.status === 'expired') {
    return { kind: 'expired' };
  }
  if (!link.expiresAt) {
    return { kind: 'never' };
  }
  return Date.parse(link.expiresAt) <= now
    ? { kind: 'expired' }
    : { kind: 'expires', at: link.expiresAt };
};
