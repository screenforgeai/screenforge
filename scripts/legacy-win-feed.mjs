/**
 * Writes a copy of a Squirrel RELEASES manifest whose packages are full URLs
 * into the given feed folder.
 *
 * Windows builds up to 0.10.0 gave Squirrel `<feed>/RELEASES` as the feed URL.
 * Squirrel adds `/RELEASES` itself, so those installs read
 * `<feed>/RELEASES/RELEASES` and look for packages under `<feed>/RELEASES/`.
 * upload-release-to-r2-windows.sh puts this copy at that path, so those
 * installs can still update to a build with the fixed feed URL.
 *
 * Usage: node scripts/legacy-win-feed.mjs <RELEASES file> <feed folder URL> <output file>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same shape Squirrel reads: SHA1, package, size, then an optional comment.
const ENTRY = /^(\uFEFF?[0-9a-fA-F]{40}\s+)(\S+)(\s+\d+[^\n]*)$/;

export function pointReleasesAtFeed(releases, feedUrl) {
  const feed = feedUrl.replace(/\/+$/, '');
  let packages = 0;

  const lines = releases.split('\n').map((line) => {
    if (line.replace(/^\uFEFF/, '').trim() === '') {
      return line;
    }
    const match = line.match(ENTRY);
    if (!match) {
      throw new Error(`Invalid RELEASES entry: ${line}`);
    }
    packages += 1;
    const [, head, name, tail] = match;
    return /^https?:\/\//.test(name) ? line : `${head}${feed}/${name}${tail}`;
  });

  if (packages === 0) {
    throw new Error('The RELEASES manifest lists no packages.');
  }
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [releasesPath, feedUrl, outputPath] = process.argv.slice(2);
  if (!releasesPath || !feedUrl || !outputPath) {
    console.error(
      'Usage: node scripts/legacy-win-feed.mjs <RELEASES file> <feed folder URL> <output file>',
    );
    process.exit(1);
  }
  fs.writeFileSync(outputPath, pointReleasesAtFeed(fs.readFileSync(releasesPath, 'utf8'), feedUrl));
}
