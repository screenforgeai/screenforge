// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { uploadRendererSourcemaps } = require('./posthog-sourcemaps.js');

const releaseEnv = {
  POSTHOG_CLI_API_KEY: 'phx_test',
  POSTHOG_CLI_PROJECT_ID: '1',
  POSTHOG_CLI_SCRIPT: '/opt/posthog-cli/run-posthog-cli.js',
};

describe('uploadRendererSourcemaps', () => {
  let buildPath: string;
  let assetsDir: string;
  const log = { info: vi.fn(), warn: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    buildPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-sourcemaps-'));
    assetsDir = path.join(buildPath, '.vite', 'renderer', 'main_window', 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'index.js'), 'x\n//# sourceMappingURL=index.js.map');
    fs.writeFileSync(path.join(assetsDir, 'index.js.map'), '{}');
  });

  afterEach(() => {
    fs.rmSync(buildPath, { recursive: true, force: true });
  });

  it('does nothing outside a release build', () => {
    const run = vi.fn();

    const outcome = uploadRendererSourcemaps(buildPath, '1.2.3', { env: {}, run, log });

    expect(outcome).toBe('skipped');
    expect(run).not.toHaveBeenCalled();
  });

  it('injects and uploads the renderer bundle through the CLI script with Node', () => {
    const run = vi.fn(() => ({ status: 0 }));

    const outcome = uploadRendererSourcemaps(buildPath, '1.2.3', { env: releaseEnv, run, log });

    expect(outcome).toBe('uploaded');
    expect(run).toHaveBeenCalledWith(
      process.execPath,
      [
        releaseEnv.POSTHOG_CLI_SCRIPT,
        'sourcemap',
        'process',
        '--directory',
        path.join(buildPath, '.vite', 'renderer'),
        '--release-name',
        'screenforge',
        '--release-version',
        '1.2.3',
        '--delete-after',
      ],
      expect.objectContaining({ env: releaseEnv }),
    );
  });

  it('never fails the build when the upload fails', () => {
    const run = vi.fn(() => ({ status: 1 }));

    const outcome = uploadRendererSourcemaps(buildPath, '1.2.3', { env: releaseEnv, run, log });

    expect(outcome).toBe('failed');
    expect(log.warn).toHaveBeenCalled();
  });

  it('never ships source maps, whatever happened to the upload', () => {
    const run = vi.fn(() => {
      throw new Error('spawn failed');
    });

    expect(uploadRendererSourcemaps(buildPath, '1.2.3', { env: releaseEnv, run, log })).toBe(
      'failed',
    );
    expect(fs.existsSync(path.join(assetsDir, 'index.js.map'))).toBe(false);
    // Nor a comment pointing at the map that is no longer there.
    expect(fs.readFileSync(path.join(assetsDir, 'index.js'), 'utf8')).toBe('x\n');
  });

  it('skips a build with no renderer bundle', () => {
    fs.rmSync(path.join(buildPath, '.vite'), { recursive: true });
    const run = vi.fn();

    expect(uploadRendererSourcemaps(buildPath, '1.2.3', { env: releaseEnv, run, log })).toBe(
      'skipped',
    );
    expect(run).not.toHaveBeenCalled();
  });
});
