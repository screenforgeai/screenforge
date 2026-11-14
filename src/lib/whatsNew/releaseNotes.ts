// Inlined into the renderer bundle by Vite at build time, so the notes ship
// with the app and work offline in both `pnpm start` and packaged builds.
import changelogMarkdown from '../../../CHANGELOG.md?raw';
import { parseChangelog, type ReleaseNotes } from './changelog';

let cached: ReleaseNotes[] | null = null;

export const getBundledReleases = (): ReleaseNotes[] => {
  cached ??= parseChangelog(changelogMarkdown);
  return cached;
};
