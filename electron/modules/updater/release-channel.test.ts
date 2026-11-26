// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  feedBaseUrlForChannel,
  latestMacFeedVersion,
  latestWindowsFeedVersion,
  releasesUrlForChannel,
  resolveUpdateChannel,
} from './release-channel';

describe('resolveUpdateChannel', () => {
  it('is stable by default', () => {
    expect(resolveUpdateChannel({ earlyUpdates: false, betaFlag: false })).toBe('stable');
  });

  it('is beta when the user turned on early updates', () => {
    expect(resolveUpdateChannel({ earlyUpdates: true, betaFlag: false })).toBe('beta');
  });

  it('is beta when PostHog puts this install in the beta', () => {
    expect(resolveUpdateChannel({ earlyUpdates: false, betaFlag: true })).toBe('beta');
  });

  it('lets SCREENFORGE_UPDATE_CHANNEL win over the setting and the flag', () => {
    expect(resolveUpdateChannel({ override: 'stable', earlyUpdates: true, betaFlag: true })).toBe(
      'stable',
    );
    expect(resolveUpdateChannel({ override: 'beta', earlyUpdates: false, betaFlag: false })).toBe(
      'beta',
    );
  });

  it('ignores an override that is not a channel', () => {
    expect(resolveUpdateChannel({ override: 'nightly', earlyUpdates: true, betaFlag: false })).toBe(
      'beta',
    );
    expect(resolveUpdateChannel({ override: '', earlyUpdates: false, betaFlag: false })).toBe(
      'stable',
    );
  });
});

describe('feedBaseUrlForChannel', () => {
  const release = 'https://cdn.example.com/screenforge/updates/release/darwin/arm64';

  it('keeps the built-in feed for stable', () => {
    expect(feedBaseUrlForChannel(release, 'stable')).toBe(release);
  });

  it('points beta at the beta feed next to it', () => {
    expect(feedBaseUrlForChannel(release, 'beta')).toBe(
      'https://cdn.example.com/screenforge/updates/beta/darwin/arm64',
    );
    expect(
      feedBaseUrlForChannel(
        'https://cdn.example.com/screenforge/updates/release/win32/x64/',
        'beta',
      ),
    ).toBe('https://cdn.example.com/screenforge/updates/beta/win32/x64');
  });

  it('keeps a feed it cannot place in a channel', () => {
    const custom = 'https://cdn.example.com/my-feed';
    expect(feedBaseUrlForChannel(custom, 'beta')).toBe(custom);
  });
});

describe('releasesUrlForChannel', () => {
  it('leaves the stable URL alone', () => {
    expect(releasesUrlForChannel('https://screenforge.co/api/builds', 'stable')).toBe(
      'https://screenforge.co/api/builds',
    );
  });

  it('asks for beta builds on the beta channel', () => {
    expect(releasesUrlForChannel('https://screenforge.co/api/builds', 'beta')).toBe(
      'https://screenforge.co/api/builds?channel=beta',
    );
  });
});

describe('latestMacFeedVersion', () => {
  it("reads the manifest's current release", () => {
    expect(latestMacFeedVersion({ currentRelease: '0.11.0', releases: [] })).toBe('0.11.0');
  });

  it('has no version for a manifest without one', () => {
    expect(latestMacFeedVersion({ releases: [] })).toBeUndefined();
    expect(latestMacFeedVersion({ currentRelease: '' })).toBeUndefined();
    expect(latestMacFeedVersion(null)).toBeUndefined();
    expect(latestMacFeedVersion('0.11.0')).toBeUndefined();
  });
});

describe('latestWindowsFeedVersion', () => {
  it('reads the newest full package in a Squirrel RELEASES file', () => {
    const releases = [
      '8F1C0A9E5B3D2C1F0E9D8C7B6A5F4E3D2C1B0A99 Screenforge-0.9.2-full.nupkg 120000000',
      '0123456789ABCDEF0123456789ABCDEF01234567 Screenforge-0.11.0-full.nupkg 121000000',
      'FEDCBA9876543210FEDCBA9876543210FEDCBA98 Screenforge-0.10.4-full.nupkg 119000000',
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA Screenforge-0.12.0-delta.nupkg 900000',
    ].join('\r\n');

    expect(latestWindowsFeedVersion(releases)).toBe('0.11.0');
  });

  it('has no version for an empty or unreadable file', () => {
    expect(latestWindowsFeedVersion('')).toBeUndefined();
    expect(latestWindowsFeedVersion('<html>Not found</html>')).toBeUndefined();
  });
});
