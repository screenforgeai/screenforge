// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { pointReleasesAtFeed } from './legacy-win-feed.mjs';

const FEED = 'https://download.example.com/stable/updates/release/win32/x64';
const SHA = '775244E0E2A3EF9A1FE5C988544D1B9ACBDA7831';
const DELTA_SHA = '0123456789abcdef0123456789abcdef01234567';

describe('pointReleasesAtFeed', () => {
  it('turns each package name into a full URL in the feed folder', () => {
    const releases = `${SHA} Screenforge-0.11.0-full.nupkg 272394138\n${DELTA_SHA} Screenforge-0.11.0-delta.nupkg 1024\n`;

    expect(pointReleasesAtFeed(releases, FEED)).toBe(
      `${SHA} ${FEED}/Screenforge-0.11.0-full.nupkg 272394138\n` +
        `${DELTA_SHA} ${FEED}/Screenforge-0.11.0-delta.nupkg 1024\n`,
    );
  });

  it('keeps the byte order mark and Windows line endings Squirrel wrote', () => {
    const releases = `\uFEFF${SHA} Screenforge-0.11.0-full.nupkg 272394138\r\n`;

    expect(pointReleasesAtFeed(releases, `${FEED}/`)).toBe(
      `\uFEFF${SHA} ${FEED}/Screenforge-0.11.0-full.nupkg 272394138\r\n`,
    );
  });

  it('leaves entries that already have a full URL alone', () => {
    const releases = `${SHA} https://cdn.example.com/Screenforge-0.11.0-full.nupkg 272394138`;

    expect(pointReleasesAtFeed(releases, FEED)).toBe(releases);
  });

  it('refuses a line Squirrel could not read', () => {
    expect(() => pointReleasesAtFeed('not a release entry\n', FEED)).toThrow('not a release entry');
  });

  it('refuses a manifest with no packages', () => {
    expect(() => pointReleasesAtFeed('\uFEFF\r\n', FEED)).toThrow('no packages');
  });
});
