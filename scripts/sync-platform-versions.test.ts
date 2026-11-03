// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncPlatformVersions } from './sync-platform-versions.mjs';

describe('syncPlatformVersions', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-versions-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.6.16' }));
    fs.writeFileSync(
      path.join(root, 'versions.json'),
      JSON.stringify({ mac: '0.6.10', win: '0.1.0', linux: '0.1.0' }),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('gives every platform the package version, so each release ships all three', () => {
    expect(syncPlatformVersions(root)).toEqual({ mac: '0.6.16', win: '0.6.16', linux: '0.6.16' });
    expect(JSON.parse(fs.readFileSync(path.join(root, 'versions.json'), 'utf8'))).toEqual({
      mac: '0.6.16',
      win: '0.6.16',
      linux: '0.6.16',
    });
  });

  it('keeps the file formatted with a trailing newline', () => {
    syncPlatformVersions(root);

    expect(fs.readFileSync(path.join(root, 'versions.json'), 'utf8')).toBe(
      '{\n  "mac": "0.6.16",\n  "win": "0.6.16",\n  "linux": "0.6.16"\n}\n',
    );
  });
});
