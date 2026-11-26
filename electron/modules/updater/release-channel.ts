/**
 * Update channels. Every release lands on the beta feed first and reaches
 * everyone once it is promoted to the release (stable) feed, so an install
 * reads the beta feed only when someone chose that: the user ("Get early
 * updates") or us (the beta-updates PostHog flag).
 */
export type UpdateChannel = 'stable' | 'beta';

type ChannelInputs = {
  /** SCREENFORGE_UPDATE_CHANNEL, for testing a build against either feed. */
  override?: string;
  /** The "Get early updates" setting. */
  earlyUpdates: boolean;
  /** The beta-updates PostHog flag for this install. */
  betaFlag: boolean;
};

export function resolveUpdateChannel({
  override,
  earlyUpdates,
  betaFlag,
}: ChannelInputs): UpdateChannel {
  const forced = override?.trim();
  if (forced === 'stable' || forced === 'beta') {
    return forced;
  }
  return earlyUpdates || betaFlag ? 'beta' : 'stable';
}

// The built-in feeds end in /updates/release/<platform>/<arch>; beta sits beside it.
const RELEASE_FEED_SEGMENT = /\/updates\/release\/([^/]+\/[^/]+)\/?$/;

/** The feed for this channel; a feed outside that layout is used as it is. */
export function feedBaseUrlForChannel(baseUrl: string, channel: UpdateChannel): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (channel === 'stable' || !RELEASE_FEED_SEGMENT.test(trimmed)) {
    return trimmed;
  }
  return trimmed.replace(RELEASE_FEED_SEGMENT, '/updates/beta/$1');
}

/** The website's build list; beta installs also see builds not yet promoted. */
export function releasesUrlForChannel(releasesUrl: string, channel: UpdateChannel): string {
  if (channel === 'stable') {
    return releasesUrl;
  }
  const url = new URL(releasesUrl);
  url.searchParams.set('channel', 'beta');
  return url.toString();
}

/** The version a Squirrel.Mac RELEASES.json manifest would install. */
export function latestMacFeedVersion(manifest: unknown): string | undefined {
  if (typeof manifest !== 'object' || manifest === null) {
    return undefined;
  }
  const { currentRelease } = manifest as { currentRelease?: unknown };
  return typeof currentRelease === 'string' && currentRelease.trim()
    ? currentRelease.trim()
    : undefined;
}

// "<sha1> Screenforge-0.11.0-full.nupkg <size>"; delta packages need a full one anyway.
const FULL_PACKAGE = /-(\d+(?:\.\d+)+)-full\.nupkg\b/;

/** The newest full package in a Squirrel.Windows RELEASES file. */
export function latestWindowsFeedVersion(releases: string): string | undefined {
  let latest: number[] | undefined;
  let latestText: string | undefined;
  for (const line of releases.split(/\r?\n/)) {
    const version = line.match(FULL_PACKAGE)?.[1];
    if (!version) {
      continue;
    }
    const parts = version.split('.').map(Number);
    if (!latest || compareParts(parts, latest) > 0) {
      latest = parts;
      latestText = version;
    }
  }
  return latestText;
}

function compareParts(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
