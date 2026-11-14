import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json';
import { getBundledReleases } from './releaseNotes';

describe('bundled CHANGELOG.md', () => {
  const releases = getBundledReleases();

  it('parses into releases, newest first, starting at the package version', () => {
    expect(releases.length).toBeGreaterThan(0);
    expect(releases[0].version).toBe(packageJson.version);
  });

  it('has no commit hashes left in any entry', () => {
    const text = releases.flatMap((r) => [...r.newItems, ...r.fixItems]).map((i) => i.text);
    expect(text.length).toBeGreaterThan(0);
    for (const entry of text) {
      expect(entry).not.toMatch(/^[0-9a-f]{7,40}:/);
    }
  });
});
