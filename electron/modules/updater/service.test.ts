// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => '0.0.22'),
    isPackaged: true,
  },
  autoUpdater: {
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('electron', () => ({
  app: electronMock.app,
  autoUpdater: electronMock.autoUpdater,
}));

vi.mock('../../lib/logger', () => ({
  default: loggerMock,
}));

async function loadServiceModule() {
  return import('./service');
}

describe('updater service', () => {
  const originalPlatform = process.platform;
  const originalArch = process.arch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    electronMock.app.isPackaged = true;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
    Object.defineProperty(process, 'arch', {
      configurable: true,
      value: originalArch,
    });
  });

  it('disables auto-update in unpackaged builds', async () => {
    electronMock.app.isPackaged = false;
    const { createUpdaterAdapter } = await loadServiceModule();

    expect(createUpdaterAdapter()).toEqual({
      kind: 'disabled',
      reason: 'not_packaged',
    });
  });

  it('disables auto-update on linux', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'linux',
    });
    const { createUpdaterAdapter } = await loadServiceModule();

    expect(createUpdaterAdapter()).toEqual({
      kind: 'disabled',
      reason: 'unsupported',
    });
  });

  it('disables Windows auto-update when the feed URL is missing', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32',
    });
    const { createUpdaterAdapter } = await loadServiceModule();

    expect(createUpdaterAdapter({ winUpdateBaseUrl: '' })).toEqual({
      kind: 'disabled',
      reason: 'missing_feed',
    });
  });

  it('creates an active Windows updater adapter when a feed URL is configured', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'win32',
    });
    const { createUpdaterAdapter } = await loadServiceModule();

    expect(
      createUpdaterAdapter({
        winUpdateBaseUrl: 'https://updates.example.com/screenforge/updates/release/win32/x64',
      }),
    ).toMatchObject({
      kind: 'active',
    });
  });

  it('disables macOS auto-update when the feed URL is missing', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    });
    Object.defineProperty(process, 'arch', {
      configurable: true,
      value: 'arm64',
    });
    const { createUpdaterAdapter } = await loadServiceModule();

    expect(createUpdaterAdapter({ macUpdateBaseUrl: '' })).toEqual({
      kind: 'disabled',
      reason: 'missing_feed',
    });
  });

  it('creates an active macOS updater adapter for packaged darwin arm64 builds', async () => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    });
    Object.defineProperty(process, 'arch', {
      configurable: true,
      value: 'arm64',
    });
    const { createUpdaterAdapter } = await loadServiceModule();

    expect(
      createUpdaterAdapter({
        macUpdateBaseUrl: 'https://updates.example.com/screenforge/updates/release/darwin/arm64',
      }),
    ).toMatchObject({
      kind: 'active',
    });
  });

  it('resets the update quit flag when restart is rejected', async () => {
    electronMock.app.isPackaged = false;
    const { isQuittingForUpdate, restartToApplyUpdate } = await loadServiceModule();

    await expect(restartToApplyUpdate()).rejects.toThrow('Auto-update is disabled.');

    expect(isQuittingForUpdate()).toBe(false);
  });
});
