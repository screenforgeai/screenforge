/**
 * Platform-aware build wrapper.
 *
 * Usage:
 *   node scripts/make-platform.mjs mac   → sets version from versions.json["mac"], runs forge for darwin
 *   node scripts/make-platform.mjs win   → sets version from versions.json["win"], runs forge for win32
 *
 * The script temporarily patches package.json's "version" field, runs
 * electron-forge make, then restores the original value — even on failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const platform = process.argv[2];
if (!platform || !['mac', 'win', 'linux'].includes(platform)) {
  console.error('Usage: node scripts/make-platform.mjs <mac|win|linux> [extra forge args...]');
  process.exit(1);
}

// Any args after the platform are forwarded to electron-forge make
const extraArgs = process.argv.slice(3);

const versionsPath = path.join(root, 'versions.json');
const packagePath = path.join(root, 'package.json');
// On Windows, node_modules/.bin contains .cmd wrappers — the extension-less file is a POSIX script
// that can't be executed directly by spawnSync on Windows.
const forgeBinName = process.platform === 'win32' ? 'electron-forge.cmd' : 'electron-forge';
const forgeBin = path.join(root, 'node_modules', '.bin', forgeBinName);
const forgePlatform = platform === 'mac' ? 'darwin' : platform === 'win' ? 'win32' : 'linux';

const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
const targetVersion = versions[platform];

if (!targetVersion) {
  console.error(`No version entry for "${platform}" in versions.json`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const originalVersion = pkg.version;

// Patch
pkg.version = targetVersion;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`[make-platform] version → ${targetVersion} (${platform})`);

let exitCode = 0;
try {
  const result = spawnSync(forgeBin, ['make', '--platform', forgePlatform, ...extraArgs], {
    stdio: 'inherit',
    cwd: root,
    env: process.env,
    shell: process.platform === 'win32', // .cmd files require cmd.exe on Windows
  });
  if (result.error) {
    console.error(`[make-platform] Failed to spawn electron-forge: ${result.error.message}`);
  }
  exitCode = result.status ?? 1;
} finally {
  // Restore
  pkg.version = originalVersion;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`[make-platform] version restored → ${originalVersion}`);
}

process.exit(exitCode);
