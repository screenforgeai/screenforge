import { describe, expect, it } from 'vitest';
import { formatShareDate, isShareableFormat, shareExpiry } from './share';

const NOW = Date.parse('2026-11-06T12:00:00.000Z');

describe('isShareableFormat', () => {
  it('shares mp4 and webm only', () => {
    expect(isShareableFormat('mp4')).toBe(true);
    expect(isShareableFormat('webm')).toBe(true);
    expect(isShareableFormat('mov')).toBe(false);
    expect(isShareableFormat('gif')).toBe(false);
  });
});

describe('formatShareDate', () => {
  it('gives a short day and month this year', () => {
    expect(formatShareDate('2026-12-06T10:00:00.000Z', 'en-GB', NOW)).toBe('6 Dec');
  });

  it('adds the year when it is not this year', () => {
    expect(formatShareDate('2027-01-05T10:00:00.000Z', 'en-GB', NOW)).toBe('5 Jan 2027');
  });
});

describe('shareExpiry', () => {
  it('never expires on paid plans', () => {
    expect(shareExpiry({ expiresAt: null, status: 'live' }, NOW)).toEqual({ kind: 'never' });
  });

  it('expires on a date, or has expired', () => {
    expect(shareExpiry({ expiresAt: '2026-12-06T10:00:00.000Z', status: 'live' }, NOW)).toEqual({
      kind: 'expires',
      at: '2026-12-06T10:00:00.000Z',
    });
    expect(shareExpiry({ expiresAt: '2026-11-01T00:00:00.000Z', status: 'live' }, NOW)).toEqual({
      kind: 'expired',
    });
    expect(shareExpiry({ expiresAt: null, status: 'expired' }, NOW)).toEqual({ kind: 'expired' });
  });

  it('says when a link was removed', () => {
    expect(shareExpiry({ expiresAt: null, status: 'removed' }, NOW)).toEqual({ kind: 'removed' });
  });
});
