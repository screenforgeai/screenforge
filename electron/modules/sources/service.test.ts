// @vitest-environment node

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/Users/dev/projects/screenforge/app'),
  },
  desktopCapturerGetSources: vi.fn(),
  getMediaAccessStatus: vi.fn(),
  getAllDisplays: vi.fn(() => [] as unknown[]),
  getPrimaryDisplay: vi.fn(() => ({ id: -1 })),
}));

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('electron', () => ({
  app: electronMock.app,
  desktopCapturer: {
    getSources: electronMock.desktopCapturerGetSources,
  },
  systemPreferences: {
    getMediaAccessStatus: electronMock.getMediaAccessStatus,
  },
  screen: {
    getAllDisplays: electronMock.getAllDisplays,
    getPrimaryDisplay: electronMock.getPrimaryDisplay,
  },
}));

vi.mock('node:child_process', () => ({
  execFile: childProcessMock.execFile,
}));

vi.mock('../../lib/logger', () => ({
  default: loggerMock,
}));

vi.mock('../../lib/macos-native-capture', () => ({
  shouldUseMacNativeCapture: vi.fn(() => false),
  shouldUseNativeCapture: vi.fn(() => false),
}));

async function loadSourcesModule() {
  return import('./service');
}

describe('sources service', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    });

    electronMock.getMediaAccessStatus.mockReturnValue('denied');
    electronMock.desktopCapturerGetSources.mockResolvedValue([]);
    childProcessMock.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: { timeout?: number },
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        callback(null, 'denied\n');
        return undefined as never;
      },
    );
  });

  it('parses the native helper screen-access status', async () => {
    childProcessMock.execFile.mockImplementationOnce(
      (
        _file: string,
        _args: string[],
        _options: { timeout?: number },
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        callback(null, 'granted\n');
        return undefined as never;
      },
    );

    const { getMacScreenPermissionStatus } = await loadSourcesModule();

    await expect(getMacScreenPermissionStatus()).resolves.toBe('granted');
    expect(childProcessMock.execFile).toHaveBeenCalledOnce();
    expect(childProcessMock.execFile.mock.calls[0]?.[1]).toEqual(['--check-screen-access']);
    expect(electronMock.desktopCapturerGetSources).not.toHaveBeenCalled();
  });

  it('returns empty sources without calling desktopCapturer when screen permission is missing', async () => {
    const { getSources } = await loadSourcesModule();

    await expect(getSources()).resolves.toEqual([]);

    expect(electronMock.desktopCapturerGetSources).not.toHaveBeenCalled();
  });

  it('returns cached sources instead of re-enumerating after permission becomes missing', async () => {
    const screenThumbnail = {
      toDataURL: () => 'data:image/png;base64,screen',
    };

    childProcessMock.execFile
      .mockImplementationOnce(
        (
          _file: string,
          _args: string[],
          _options: { timeout?: number },
          callback: (error: Error | null, stdout: string) => void,
        ) => {
          callback(null, 'granted\n');
          return undefined as never;
        },
      )
      .mockImplementation(
        (
          _file: string,
          _args: string[],
          _options: { timeout?: number },
          callback: (error: Error | null, stdout: string) => void,
        ) => {
          callback(null, 'denied\n');
          return undefined as never;
        },
      );

    electronMock.desktopCapturerGetSources.mockResolvedValue([
      {
        id: 'screen:0',
        name: 'Entire Screen',
        thumbnail: screenThumbnail,
        appIcon: null,
      },
    ]);

    const { getSources } = await loadSourcesModule();

    const firstSources = await getSources();
    const secondSources = await getSources();

    expect(firstSources).toEqual([
      {
        id: 'screen:0',
        name: 'Entire Screen',
        thumbnail: 'data:image/png;base64,screen',
        appIcon: null,
        appName: undefined,
        windowTitle: undefined,
      },
    ]);
    expect(secondSources).toEqual(firstSources);
    expect(electronMock.desktopCapturerGetSources).toHaveBeenCalledTimes(1);
  });

  describe('two monitors on Windows', () => {
    // Windows numbers screen sources by position; only display_id names the monitor.
    const laptop = {
      id: 2528732444,
      label: 'Built-in Display',
      size: { width: 1440, height: 900 },
    };
    const external = { id: 1234567, label: '', size: { width: 2560, height: 1440 } };

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
      electronMock.getAllDisplays.mockReturnValue([external, laptop]);
      electronMock.getPrimaryDisplay.mockReturnValue(laptop);
      electronMock.desktopCapturerGetSources.mockResolvedValue([
        { id: 'screen:0:0', name: 'Screen 1', display_id: String(laptop.id) },
        { id: 'screen:1:0', name: 'Screen 2', display_id: String(external.id) },
      ]);
    });

    it('lists the displays in OS order without capturing anything', async () => {
      const { getDisplays } = await loadSourcesModule();

      expect(getDisplays()).toEqual([
        { id: external.id, label: null, width: 2560, height: 1440, isPrimary: false },
        {
          id: laptop.id,
          label: 'Built-in Display',
          width: 1440,
          height: 900,
          isPrimary: true,
        },
      ]);
      expect(electronMock.desktopCapturerGetSources).not.toHaveBeenCalled();
    });

    it("finds a display's screen source by display_id, not by the number in its id", async () => {
      const { getScreenSourceForDisplay } = await loadSourcesModule();

      await expect(getScreenSourceForDisplay(external.id)).resolves.toBe('screen:1:0');
      await expect(getScreenSourceForDisplay(laptop.id)).resolves.toBe('screen:0:0');
      expect(electronMock.desktopCapturerGetSources).toHaveBeenCalledWith(
        expect.objectContaining({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }),
      );
    });

    it('remembers which display each screen source shows, for the recording', async () => {
      const { getScreenSourceForDisplay, getDisplayIdForSource } = await loadSourcesModule();

      expect(getDisplayIdForSource('screen:1:0')).toBeNull();
      await getScreenSourceForDisplay(laptop.id);

      expect(getDisplayIdForSource('screen:0:0')).toBe(String(laptop.id));
      expect(getDisplayIdForSource('screen:1:0')).toBe(String(external.id));
      expect(getDisplayIdForSource('screen:7:0')).toBeNull();
    });

    it('finds no source for a display no screen shows, or when listing fails', async () => {
      const { getScreenSourceForDisplay } = await loadSourcesModule();

      await expect(getScreenSourceForDisplay(42)).resolves.toBeNull();
      electronMock.desktopCapturerGetSources.mockRejectedValueOnce(new Error('boom'));
      await expect(getScreenSourceForDisplay(laptop.id)).resolves.toBeNull();
    });
  });

  it('finds no screen source on macOS until Screen Recording is allowed', async () => {
    const { getScreenSourceForDisplay } = await loadSourcesModule();

    await expect(getScreenSourceForDisplay(1)).resolves.toBeNull();
    expect(electronMock.desktopCapturerGetSources).not.toHaveBeenCalled();
  });

  describe('on Linux Wayland', () => {
    const savedSessionType = process.env.XDG_SESSION_TYPE;

    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'linux',
      });
      process.env.XDG_SESSION_TYPE = 'wayland';
    });

    afterEach(() => {
      if (savedSessionType === undefined) {
        delete process.env.XDG_SESSION_TYPE;
      } else {
        process.env.XDG_SESSION_TYPE = savedSessionType;
      }
    });

    it('returns a synthetic display source without opening the portal picker', async () => {
      const { getSources } = await loadSourcesModule();

      await expect(getSources()).resolves.toEqual([
        {
          id: 'screen:wayland',
          name: 'Entire screen',
          thumbnail: null,
          appIcon: null,
        },
      ]);

      // desktopCapturer.getSources() triggers the xdg-desktop-portal dialog on
      // Wayland — enumerating must never call it.
      expect(electronMock.desktopCapturerGetSources).not.toHaveBeenCalled();
      expect(childProcessMock.execFile).not.toHaveBeenCalled();
    });

    it('finds no screen source: the monitor is picked in the share dialog', async () => {
      const { getScreenSourceForDisplay } = await loadSourcesModule();

      await expect(getScreenSourceForDisplay(1)).resolves.toBeNull();
      expect(electronMock.desktopCapturerGetSources).not.toHaveBeenCalled();
    });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
  });
});
