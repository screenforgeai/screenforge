/**
 * Parses the Changesets-generated CHANGELOG.md into release notes for the
 * "What's new" dialog. Kept free of Electron/React so the main process and
 * tests can use it too.
 *
 * Expected shape:
 *   ## 0.8.0
 *   ### Minor Changes
 *   - 58d2d35: Text…
 *     - optional nested detail
 *   ### Patch Changes
 *   - 33b08d7: Text…
 */

export type ReleaseNoteItem = {
  /** Plain text, markdown syntax and the commit hash removed. */
  text: string;
  /** Indented follow-up lines of the same bullet, as plain text. */
  details: string[];
};

export type ReleaseNotes = {
  version: string;
  /** Major and minor changes, in changelog order. */
  newItems: ReleaseNoteItem[];
  /** Patch changes. */
  fixItems: ReleaseNoteItem[];
};

type ParsedVersion = { core: [number, number, number]; pre: string | null };

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const COMMIT_PREFIX_RE = /^[0-9a-f]{7,40}:\s*/i;
const BOOKKEEPING_RE = /^Updated dependencies\b/i;

const parseVersion = (version: string): ParsedVersion | null => {
  const match = VERSION_RE.exec(version.trim());
  if (!match) {
    return null;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ?? null,
  };
};

export const isValidVersion = (version: unknown): version is string =>
  typeof version === 'string' && parseVersion(version) !== null;

const comparePrerelease = (a: string | null, b: string | null): number => {
  if (a === b) {
    return 0;
  }
  // A release outranks any of its prereleases.
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return a.localeCompare(b, 'en', { numeric: true });
};

/** Semver-style ordering. Unparseable versions sort below every valid one. */
export const compareVersions = (a: string, b: string): number => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    return (pa ? 1 : 0) - (pb ? 1 : 0);
  }
  for (let i = 0; i < 3; i += 1) {
    const diff = pa.core[i] - pb.core[i];
    if (diff !== 0) {
      return diff;
    }
  }
  return comparePrerelease(pa.pre, pb.pre);
};

/** Removes the markdown syntax Changesets entries use, so the text renders as-is. */
const toPlainText = (markdown: string): string =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

type Section = 'new' | 'fixes' | null;

const sectionFor = (heading: string): Section => {
  if (/\b(major|minor)\b/i.test(heading)) {
    return 'new';
  }
  if (/\bpatch\b/i.test(heading)) {
    return 'fixes';
  }
  return null;
};

export const parseChangelog = (markdown: string): ReleaseNotes[] => {
  const releases: ReleaseNotes[] = [];
  let release: ReleaseNotes | null = null;
  let section: Section = null;
  let item: ReleaseNoteItem | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const versionHeading = /^##\s+(\S+)\s*$/.exec(line);
    if (versionHeading) {
      release = { version: versionHeading[1].replace(/^v/, ''), newItems: [], fixItems: [] };
      releases.push(release);
      section = null;
      item = null;
      continue;
    }

    const sectionHeading = /^###\s+(.+)$/.exec(line);
    if (sectionHeading) {
      section = sectionFor(sectionHeading[1]);
      item = null;
      continue;
    }

    if (/^#\s/.test(line) || !release || !section) {
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const text = toPlainText(bullet[1].replace(COMMIT_PREFIX_RE, ''));
      if (!text || BOOKKEEPING_RE.test(text)) {
        item = null;
        continue;
      }
      item = { text, details: [] };
      (section === 'new' ? release.newItems : release.fixItems).push(item);
      continue;
    }

    if (item) {
      const detail = toPlainText(line.trim().replace(/^[-*]\s+/, ''));
      if (detail) {
        item.details.push(detail);
      }
    }
  }

  return releases;
};

const hasChanges = (release: ReleaseNotes) =>
  release.newItems.length > 0 || release.fixItems.length > 0;

const newestFirst = (releases: ReleaseNotes[]) =>
  [...releases].sort((a, b) => compareVersions(b.version, a.version));

/**
 * The releases a user hasn't seen: everything newer than `sinceVersion` up to
 * and including `currentVersion`, newest first. Without a `sinceVersion` (we
 * don't know what they ran before) only the current version is returned.
 */
export const selectReleases = (
  releases: ReleaseNotes[],
  { sinceVersion, currentVersion }: { sinceVersion: string | null; currentVersion: string },
): ReleaseNotes[] =>
  newestFirst(
    releases.filter((release) => {
      if (!hasChanges(release) || compareVersions(release.version, currentVersion) > 0) {
        return false;
      }
      return sinceVersion === null
        ? compareVersions(release.version, currentVersion) === 0
        : compareVersions(release.version, sinceVersion) > 0;
    }),
  );

/** The newest release with notes at or below the running version, for opening on demand. */
export const selectLatestRelease = (
  releases: ReleaseNotes[],
  currentVersion: string,
): ReleaseNotes | null =>
  newestFirst(releases).find(
    (release) => hasChanges(release) && compareVersions(release.version, currentVersion) <= 0,
  ) ?? null;
