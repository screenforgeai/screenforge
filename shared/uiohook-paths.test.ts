// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const uiohookPaths = require('./uiohook-paths.js');

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
}

function writeFixtureFile(filePath: string, contents = '{}'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

describe('uiohook staging', () => {
  let rootDir: string;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  function createFixtureModules(prebuildNames: string[]): void {
    const uiohookDir = path.join(rootDir, 'node_modules', 'uiohook-napi');
    writeFixtureFile(path.join(uiohookDir, 'package.json'), '{"name":"uiohook-napi"}');
    writeFixtureFile(path.join(uiohookDir, 'dist', 'index.js'), 'module.exports = {};');
    for (const prebuildName of prebuildNames) {
      writeFixtureFile(
        path.join(uiohookDir, 'prebuilds', prebuildName, 'node.napi.node'),
        'binary',
      );
    }

    const nodeGypBuildDir = path.join(rootDir, 'node_modules', 'node-gyp-build');
    writeFixtureFile(path.join(nodeGypBuildDir, 'package.json'), '{"name":"node-gyp-build"}');
    writeFixtureFile(path.join(nodeGypBuildDir, 'index.js'), 'module.exports = {};');
    writeFixtureFile(path.join(nodeGypBuildDir, 'node-gyp-build.js'), 'module.exports = {};');
  }

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uiohook-staging-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  afterAll(() => {
    setPlatform(originalPlatform);
  });

  it('stages the Linux prebuild so packaged X11 builds get cursor tracking', () => {
    setPlatform('linux');
    createFixtureModules([`linux-${arch}`]);

    const stagedDir = uiohookPaths.stageUiohookBundle(rootDir);

    expect(stagedDir).toBe(path.resolve(rootDir, '.packaging-cache', `uiohook-napi-linux-${arch}`));
    expect(
      fs.existsSync(path.join(stagedDir, 'prebuilds', `linux-${arch}`, 'node.napi.node')),
    ).toBe(true);
    expect(fs.existsSync(path.join(stagedDir, 'dist', 'index.js'))).toBe(true);
    expect(fs.existsSync(path.join(stagedDir, 'node_modules', 'node-gyp-build', 'index.js'))).toBe(
      true,
    );
  });

  it('stages darwin and win32 prebuilds as before', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      setPlatform(platform);
      createFixtureModules([`${platform}-${arch}`]);

      const stagedDir = uiohookPaths.stageUiohookBundle(rootDir);

      expect(stagedDir).toBe(
        path.resolve(rootDir, '.packaging-cache', `uiohook-napi-${platform}-${arch}`),
      );
    }
  });

  it('returns null when the prebuild for the current platform is missing', () => {
    setPlatform('linux');
    createFixtureModules(['darwin-arm64']);

    expect(uiohookPaths.stageUiohookBundle(rootDir)).toBeNull();
  });

  it('returns null on unsupported platforms', () => {
    setPlatform('freebsd');
    createFixtureModules([`linux-${arch}`]);

    expect(uiohookPaths.stageUiohookBundle(rootDir)).toBeNull();
  });

  it('keeps the packaged dir name in sync with the staged dir name', () => {
    // recording/service.ts resolves the packaged module from
    // `${resourcesPath}/uiohook-napi-${platform}-${arch}` — the staged folder
    // must use the same naming or packaged builds lose cursor tracking.
    const packagedDir = uiohookPaths.getPackagedUiohookDir('/resources', 'linux', 'x64');
    expect(packagedDir).toBe(path.resolve('/resources', 'uiohook-napi-linux-x64'));
    expect(uiohookPaths.getStagedUiohookBaseName('linux', 'x64')).toBe('uiohook-napi-linux-x64');
  });
});
