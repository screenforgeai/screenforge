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

  describe('on linux', () => {
    function stubReleases(response: { ok: boolean; status?: number; body?: unknown }) {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: response.ok,
        status: response.status ?? 200,
        json: () => Promise.resolve(response.body),
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function releasesWithLinuxVersion(version: string) {
      return {
        status: 'success',
        data: { availability: { platforms: { linux: { version, tag: `linux-v${version}` } } } },
      };
    }

    function createListeners() {
      return {
        onChecking: vi.fn(),
        onUpdateAvailable: vi.fn(),
        onManualUpdateAvailable: vi.fn(),
        onUpdateNotAvailable: vi.fn(),
        onUpdateDownloaded: vi.fn(),
        onError: vi.fn(),
      };
    }

    async function startLinuxAdapter() {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'linux',
      });
      const { createUpdaterAdapter } = await loadServiceModule();
      const adapter = createUpdaterAdapter({
        linuxReleasesUrl: 'https://screenforge.co/api/builds',
      });
      if (adapter.kind !== 'active') {
        throw new Error('Expected an active Linux adapter.');
      }
      const listeners = createListeners();
      adapter.start(listeners);
      return { adapter, listeners };
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('disables the update check when no releases URL was built in', async () => {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'linux',
      });
      const { createUpdaterAdapter } = await loadServiceModule();

      expect(createUpdaterAdapter({ linuxReleasesUrl: '' })).toEqual({
        kind: 'disabled',
        reason: 'missing_feed',
      });
    });

    it('creates an active adapter that checks the published releases', async () => {
      const fetchMock = stubReleases({ ok: true, body: releasesWithLinuxVersion('0.0.22') });
      const { adapter, listeners } = await startLinuxAdapter();

      await adapter.checkForUpdates();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://screenforge.co/api/builds',
        expect.objectContaining({ cache: 'no-store' }),
      );
      expect(listeners.onChecking).toHaveBeenCalledOnce();
      expect(listeners.onUpdateNotAvailable).toHaveBeenCalledOnce();
      expect(listeners.onManualUpdateAvailable).not.toHaveBeenCalled();
    });

    it('reports a newer Linux release as a manual update', async () => {
      stubReleases({ ok: true, body: releasesWithLinuxVersion('0.0.23') });
      const { adapter, listeners } = await startLinuxAdapter();

      await adapter.checkForUpdates();

      expect(listeners.onManualUpdateAvailable).toHaveBeenCalledWith({ version: '0.0.23' });
      expect(listeners.onUpdateNotAvailable).not.toHaveBeenCalled();
    });

    it('treats a response without a Linux release as no update', async () => {
      stubReleases({ ok: true, body: { status: 'success', data: { availability: {} } } });
      const { adapter, listeners } = await startLinuxAdapter();

      await adapter.checkForUpdates();

      expect(listeners.onUpdateNotAvailable).toHaveBeenCalledOnce();
    });

    it('treats a Linux release without a string version as no update', async () => {
      stubReleases({
        ok: true,
        body: {
          status: 'success',
          data: { availability: { platforms: { linux: { version: 7 } } } },
        },
      });
      const { adapter, listeners } = await startLinuxAdapter();

      await adapter.checkForUpdates();

      expect(listeners.onUpdateNotAvailable).toHaveBeenCalledOnce();
    });

    it('fails the check when the releases endpoint errors', async () => {
      stubReleases({ ok: false, status: 503 });
      const { adapter } = await startLinuxAdapter();

      await expect(adapter.checkForUpdates()).rejects.toThrow('503');
    });

    it('cannot install the update itself', async () => {
      const { adapter } = await startLinuxAdapter();

      expect(() => adapter.quitAndInstall()).toThrow();
    });
  });

  it('compares release versions numerically', async () => {
    const { isNewerVersion } = await loadServiceModule();

    expect(isNewerVersion('0.7.0', '0.6.19')).toBe(true);
    expect(isNewerVersion('0.10.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('v0.7.1', '0.7.0')).toBe(true);
    expect(isNewerVersion('0.7.0', '0.7.0')).toBe(false);
    expect(isNewerVersion('0.6.19', '0.7.0')).toBe(false);
    expect(isNewerVersion('not-a-version', '0.7.0')).toBe(false);
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

  describe('update channels', () => {
    const MAC_RELEASE_FEED = 'https://cdn.example.com/screenforge/updates/release/darwin/arm64';
    const MAC_BETA_FEED = 'https://cdn.example.com/screenforge/updates/beta/darwin/arm64';
    const WIN_RELEASE_FEED = 'https://cdn.example.com/screenforge/updates/release/win32/x64';
    const WIN_BETA_FEED = 'https://cdn.example.com/screenforge/updates/beta/win32/x64';

    function stubFeed(body: { json?: unknown; text?: string }, ok = true) {
      const fetchMock = vi.fn().mockResolvedValue({
        ok,
        status: ok ? 200 : 404,
        json: () => Promise.resolve(body.json),
        text: () => Promise.resolve(body.text ?? ''),
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function createUpdater() {
      return {
        on: vi.fn(),
        checkForUpdates: vi.fn(),
        quitAndInstall: vi.fn(),
        setFeedURL: vi.fn(),
      };
    }

    function createListeners() {
      return {
        onChecking: vi.fn(),
        onUpdateAvailable: vi.fn(),
        onManualUpdateAvailable: vi.fn(),
        onUpdateNotAvailable: vi.fn(),
        onUpdateDownloaded: vi.fn(),
        onError: vi.fn(),
      };
    }

    async function startAdapter(
      platform: 'darwin' | 'win32' | 'linux',
      getChannel: () => 'stable' | 'beta',
    ) {
      const { createUpdaterAdapter } = await loadServiceModule();
      const updater = createUpdater();
      const adapter = createUpdaterAdapter({
        platform,
        arch: platform === 'darwin' ? 'arm64' : 'x64',
        macUpdateBaseUrl: MAC_RELEASE_FEED,
        winUpdateBaseUrl: WIN_RELEASE_FEED,
        linuxReleasesUrl: 'https://screenforge.co/api/builds',
        updater,
        getChannel,
      });
      if (adapter.kind !== 'active') {
        throw new Error('Expected an active adapter.');
      }
      const listeners = createListeners();
      adapter.start(listeners);
      return { adapter, updater, listeners };
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('downloads a newer macOS build from the beta feed on the beta channel', async () => {
      const fetchMock = stubFeed({ json: { currentRelease: '0.0.23', releases: [] } });
      const { adapter, updater } = await startAdapter('darwin', () => 'beta');

      await adapter.checkForUpdates();

      expect(fetchMock).toHaveBeenCalledWith(
        `${MAC_BETA_FEED}/RELEASES.json`,
        expect.objectContaining({ cache: 'no-store' }),
      );
      expect(updater.setFeedURL).toHaveBeenCalledWith({
        url: `${MAC_BETA_FEED}/RELEASES.json`,
        serverType: 'json',
      });
      expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    });

    it('keeps the stable macOS feed on the stable channel', async () => {
      stubFeed({ json: { currentRelease: '0.0.23', releases: [] } });
      const { adapter, updater } = await startAdapter('darwin', () => 'stable');

      await adapter.checkForUpdates();

      expect(updater.setFeedURL).toHaveBeenCalledWith({
        url: `${MAC_RELEASE_FEED}/RELEASES.json`,
        serverType: 'json',
      });
    });

    it('never installs an older macOS build, e.g. after leaving the beta', async () => {
      stubFeed({ json: { currentRelease: '0.0.21', releases: [] } });
      const { adapter, updater, listeners } = await startAdapter('darwin', () => 'stable');

      await adapter.checkForUpdates();

      expect(updater.checkForUpdates).not.toHaveBeenCalled();
      expect(listeners.onChecking).toHaveBeenCalledOnce();
      expect(listeners.onUpdateNotAvailable).toHaveBeenCalledOnce();
    });

    it('follows a channel change at the next check', async () => {
      stubFeed({ json: { currentRelease: '0.0.23', releases: [] } });
      let channel: 'stable' | 'beta' = 'stable';
      const { adapter, updater } = await startAdapter('darwin', () => channel);

      await adapter.checkForUpdates();
      channel = 'beta';
      await adapter.checkForUpdates();
      await adapter.checkForUpdates();

      expect(updater.setFeedURL.mock.calls.map(([options]) => options.url)).toEqual([
        `${MAC_RELEASE_FEED}/RELEASES.json`,
        `${MAC_BETA_FEED}/RELEASES.json`,
      ]);
    });

    it('fails the check when the feed cannot be read', async () => {
      stubFeed({}, false);
      const { adapter, updater } = await startAdapter('darwin', () => 'beta');

      await expect(adapter.checkForUpdates()).rejects.toThrow('404');
      expect(updater.checkForUpdates).not.toHaveBeenCalled();
    });

    it('downloads a newer Windows build from the beta feed on the beta channel', async () => {
      const fetchMock = stubFeed({
        text: '0123456789ABCDEF0123456789ABCDEF01234567 Screenforge-0.0.23-full.nupkg 1000',
      });
      const { adapter, updater } = await startAdapter('win32', () => 'beta');

      await adapter.checkForUpdates();

      expect(fetchMock).toHaveBeenCalledWith(
        `${WIN_BETA_FEED}/RELEASES`,
        expect.objectContaining({ cache: 'no-store' }),
      );
      // Squirrel gets the folder: it adds /RELEASES itself.
      expect(updater.setFeedURL).toHaveBeenCalledWith({ url: WIN_BETA_FEED });
      expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    });

    it('never installs an older Windows build', async () => {
      stubFeed({
        text: '0123456789ABCDEF0123456789ABCDEF01234567 Screenforge-0.0.22-full.nupkg 1000',
      });
      const { adapter, updater, listeners } = await startAdapter('win32', () => 'stable');

      await adapter.checkForUpdates();

      expect(updater.checkForUpdates).not.toHaveBeenCalled();
      expect(listeners.onUpdateNotAvailable).toHaveBeenCalledOnce();
    });

    it('asks for beta Linux builds on the beta channel', async () => {
      const fetchMock = stubFeed({
        json: { data: { availability: { platforms: { linux: { version: '0.0.23' } } } } },
      });
      const { adapter, listeners } = await startAdapter('linux', () => 'beta');

      await adapter.checkForUpdates();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://screenforge.co/api/builds?channel=beta',
        expect.objectContaining({ cache: 'no-store' }),
      );
      expect(listeners.onManualUpdateAvailable).toHaveBeenCalledWith({ version: '0.0.23' });
    });
  });

  it('resets the update quit flag when restart is rejected', async () => {
    electronMock.app.isPackaged = false;
    const { isQuittingForUpdate, restartToApplyUpdate } = await loadServiceModule();

    await expect(restartToApplyUpdate()).rejects.toThrow('Auto-update is disabled.');

    expect(isQuittingForUpdate()).toBe(false);
  });
});
