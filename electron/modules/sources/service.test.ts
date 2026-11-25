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

  describe('screens on Windows with two monitors', () => {
    // Windows numbers screen sources by order; only display_id names the monitor.
    const laptop = {
      id: 2528732444,
      label: 'Built-in Display',
      size: { width: 1440, height: 900 },
    };
    const external = { id: 1234567, label: '', size: { width: 2560, height: 1440 } };
    const thumbnail = (name: string) => ({ toDataURL: () => `data:image/png;base64,${name}` });

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
      electronMock.getAllDisplays.mockReturnValue([external, laptop]);
      electronMock.getPrimaryDisplay.mockReturnValue(laptop);
      electronMock.desktopCapturerGetSources.mockResolvedValue([
        {
          id: 'screen:0:0',
          name: 'Screen 1',
          display_id: String(laptop.id),
          thumbnail: thumbnail('laptop'),
          appIcon: null,
        },
        {
          id: 'screen:1:0',
          name: 'Screen 2',
          display_id: String(external.id),
          thumbnail: thumbnail('external'),
          appIcon: null,
        },
      ]);
    });

    it('lists each screen with the display it shows', async () => {
      const { getScreenSources } = await loadSourcesModule();

      const screens = await getScreenSources();

      expect(screens).toEqual([
        expect.objectContaining({
          id: 'screen:0:0',
          displayId: String(laptop.id),
          displayLabel: 'Built-in Display',
          displaySize: { width: 1440, height: 900 },
          isPrimary: true,
          thumbnail: 'data:image/png;base64,laptop',
        }),
        expect.objectContaining({
          id: 'screen:1:0',
          displayId: String(external.id),
          displayLabel: undefined,
          displaySize: { width: 2560, height: 1440 },
          isPrimary: false,
        }),
      ]);
      expect(electronMock.desktopCapturerGetSources).toHaveBeenCalledWith(
        expect.objectContaining({ types: ['screen'] }),
      );
    });

    it('remembers which display a listed screen source shows', async () => {
      const { getScreenSources, getDisplayIdForSource } = await loadSourcesModule();

      expect(getDisplayIdForSource('screen:1:0')).toBeNull();
      await getScreenSources();

      expect(getDisplayIdForSource('screen:0:0')).toBe(String(laptop.id));
      expect(getDisplayIdForSource('screen:1:0')).toBe(String(external.id));
      expect(getDisplayIdForSource('screen:7:0')).toBeNull();
    });

    it('counts the displays without listing the screens', async () => {
      const { getDisplayCount } = await loadSourcesModule();

      expect(getDisplayCount()).toBe(2);
      expect(electronMock.desktopCapturerGetSources).not.toHaveBeenCalled();
    });

    it('keeps the last screens when listing them fails', async () => {
      const { getScreenSources } = await loadSourcesModule();
      const first = await getScreenSources();
      electronMock.desktopCapturerGetSources.mockRejectedValueOnce(new Error('boom'));

      await expect(getScreenSources()).resolves.toEqual(first);
    });
  });

  it('lists no screens on macOS until Screen Recording is allowed', async () => {
    const { getScreenSources } = await loadSourcesModule();

    await expect(getScreenSources()).resolves.toEqual([]);
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

    it('lists only the synthetic screen: the monitor is picked in the share dialog', async () => {
      const { getScreenSources } = await loadSourcesModule();

      await expect(getScreenSources()).resolves.toEqual([
        expect.objectContaining({ id: 'screen:wayland' }),
      ]);
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
