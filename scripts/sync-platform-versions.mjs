/**
 * Copies package.json's version into every platform in versions.json.
 *
 * Runs after `changeset version` (see the `version-packages` script), so the
 * Version Packages PR bumps macOS, Windows and Linux together and
 * create-release-tag.sh tags all three at the new version. Without it the
 * release tags would stay on whatever versions.json last said — re-shipping a
 * version people already have, which the in-app updater ignores.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function syncPlatformVersions(rootDir) {
  const { version } = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const versionsPath = path.join(rootDir, 'versions.json');
  const platforms = Object.keys(JSON.parse(fs.readFileSync(versionsPath, 'utf8')));
  const next = Object.fromEntries(platforms.map((platform) => [platform, version]));

  fs.writeFileSync(versionsPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const next = syncPlatformVersions(root);
  console.log(`[sync-platform-versions] versions.json → ${JSON.stringify(next)}`);
}
