import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  parseChangelog,
  selectLatestRelease,
  selectReleases,
  splitFirstSentence,
  splitTitle,
} from './changelog';

const SAMPLE = `# screenforge

## 0.8.0

### Minor Changes

- 1a2b3c4: Add a What's new dialog after updates.
- abcdef0123456789abcdef0123456789abcdef01: Add **Motion** presets to the \`Video\` panel.

### Patch Changes

- 33b08d7: Fix exports on 5K displays.
- Updated dependencies [deadbee]

## 0.7.1

### Patch Changes

- 9907bf8: **Camera — Layout Presets**
  - New layout modes for the camera widget
  - See [the docs](https://screenforge.co/docs) for details

  **Cursor**
  - Cursor hidden for imported clips

## 0.7.0

### Major Changes

- 0000001: Rewrite the timeline.

### Minor Changes

- 58d2d35: Add Motion.

## 0.6.19

### Patch Changes

- 24c59b6: Fix a Windows crash.
`;

describe('compareVersions', () => {
  it('orders by major, minor, then patch numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.6.19', '0.6.2')).toBeGreaterThan(0);
    expect(compareVersions('0.7.0', '0.7.0')).toBe(0);
    expect(compareVersions('0.7.0', '0.7.1')).toBeLessThan(0);
  });

  it('ranks a prerelease below its release and ignores a leading v', () => {
    expect(compareVersions('0.8.0-beta.1', '0.8.0')).toBeLessThan(0);
    expect(compareVersions('v0.8.0', '0.8.0')).toBe(0);
  });
});

describe('parseChangelog', () => {
  const releases = parseChangelog(SAMPLE);

  it('reads every version heading, newest first', () => {
    expect(releases.map((r) => r.version)).toEqual(['0.8.0', '0.7.1', '0.7.0', '0.6.19']);
  });

  it('splits minor changes into "new" and patch changes into "fixes"', () => {
    const [latest] = releases;
    expect(latest.newItems.map((i) => i.text)).toEqual([
      "Add a What's new dialog after updates.",
      'Add Motion presets to the Video panel.',
    ]);
    expect(latest.fixItems.map((i) => i.text)).toEqual(['Fix exports on 5K displays.']);
  });

  it('strips short and full commit hash prefixes', () => {
    const allText = releases.flatMap((r) => [...r.newItems, ...r.fixItems]).map((i) => i.text);
    for (const text of allText) {
      expect(text).not.toMatch(/^[0-9a-f]{7,40}:/);
    }
  });

  it('drops Changesets "Updated dependencies" bookkeeping lines', () => {
    expect(releases[0].fixItems).toHaveLength(1);
  });

  it('treats major changes as new and lists them before minor ones', () => {
    const v070 = releases.find((r) => r.version === '0.7.0');
    expect(v070?.newItems.map((i) => i.text)).toEqual(['Rewrite the timeline.', 'Add Motion.']);
    expect(v070?.fixItems).toEqual([]);
  });

  it('keeps nested lines as plain-text details without markdown syntax', () => {
    const v071 = releases.find((r) => r.version === '0.7.1');
    expect(v071?.fixItems).toEqual([
      {
        text: 'Camera — Layout Presets',
        details: [
          'New layout modes for the camera widget',
          'See the docs for details',
          'Cursor',
          'Cursor hidden for imported clips',
        ],
      },
    ]);
  });

  it('returns nothing for an empty or heading-less file', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('# screenforge\n\nNothing yet.')).toEqual([]);
  });

  it('accepts Windows line endings', () => {
    const crlf = '## 1.0.0\r\n\r\n### Patch Changes\r\n\r\n- abc1234: Fix it.\r\n';
    expect(parseChangelog(crlf)).toEqual([
      { version: '1.0.0', newItems: [], fixItems: [{ text: 'Fix it.', details: [] }] },
    ]);
  });
});

describe('selectReleases', () => {
  const releases = parseChangelog(SAMPLE);
  const versions = (since: string | null, current: string) =>
    selectReleases(releases, { sinceVersion: since, currentVersion: current }).map(
      (r) => r.version,
    );

  it('returns only the current version after a one-step update', () => {
    expect(versions('0.7.1', '0.8.0')).toEqual(['0.8.0']);
  });

  it('returns every skipped version, newest first', () => {
    expect(versions('0.6.19', '0.8.0')).toEqual(['0.8.0', '0.7.1', '0.7.0']);
  });

  it('never includes versions newer than the running app', () => {
    expect(versions('0.6.19', '0.7.0')).toEqual(['0.7.0']);
  });

  it('returns nothing when there is nothing newer than what was seen', () => {
    expect(versions('0.8.0', '0.8.0')).toEqual([]);
    expect(versions('0.9.0', '0.8.0')).toEqual([]);
  });

  it('falls back to the current version alone when the previous version is unknown', () => {
    expect(versions(null, '0.7.1')).toEqual(['0.7.1']);
  });

  it('returns nothing for an unknown version that has no changelog entry', () => {
    expect(versions(null, '0.7.2')).toEqual([]);
  });

  it('drops releases with no listed changes', () => {
    const empty = parseChangelog('## 2.0.0\n\n## 1.0.0\n\n### Patch Changes\n\n- abc1234: x\n');
    expect(
      selectReleases(empty, { sinceVersion: '0.9.0', currentVersion: '2.0.0' }).map(
        (r) => r.version,
      ),
    ).toEqual(['1.0.0']);
  });
});

describe('selectLatestRelease', () => {
  const releases = parseChangelog(SAMPLE);

  it('picks the running version when it has notes', () => {
    expect(selectLatestRelease(releases, '0.7.1')?.version).toBe('0.7.1');
  });

  it('falls back to the newest older release for a build without its own entry', () => {
    expect(selectLatestRelease(releases, '0.7.2')?.version).toBe('0.7.1');
  });

  it('returns null when nothing is old enough', () => {
    expect(selectLatestRelease(releases, '0.1.0')).toBeNull();
  });
});

describe('splitTitle', () => {
  it('uses a short label before a colon as the title, dropping a leading "Add"', () => {
    expect(splitTitle('Screenshot mode: switch the toolbar to Screenshot.')).toEqual({
      title: 'Screenshot mode',
      body: 'Switch the toolbar to Screenshot.',
    });
    expect(splitTitle('Add click sounds: pick Mouse or Pop.')).toEqual({
      title: 'Click sounds',
      body: 'Pick Mouse or Pop.',
    });
  });

  it('has no title without a short label', () => {
    expect(splitTitle('On Linux, Screenforge now checks for updates.')).toBeNull();
    expect(
      splitTitle('Exporting a recording whose file is empty now says so: no more 416 errors.'),
    ).toBeNull();
    expect(splitTitle('Usage data (when sharing is on) drops your name: paths use ~.')).toBeNull();
  });
});

describe('splitFirstSentence', () => {
  it('splits off the first sentence', () => {
    expect(
      splitFirstSentence('New recordings start at 100% size. Older projects keep their size.'),
    ).toEqual({
      lead: 'New recordings start at 100% size.',
      rest: 'Older projects keep their size.',
    });
  });

  it('does not split on dots inside versions or abbreviations', () => {
    expect(splitFirstSentence('Fix exports on 0.8.0 builds, e.g. on Windows.')).toEqual({
      lead: 'Fix exports on 0.8.0 builds, e.g. on Windows.',
      rest: '',
    });
  });
});
