// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE,
  SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
  SCREEN_RECORDING_PERMISSION_RESTART_REQUIRED_MESSAGE,
} from '../../../src/lib/recordingStartPermissions';

const electronMock = vi.hoisted(() => ({
  app: {
    getVersion: vi.fn(() => '0.0.22'),
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
  shellOpenExternal: vi.fn(),
  isTrustedAccessibilityClient: vi.fn<[boolean], boolean>(),
  getMediaAccessStatus: vi.fn(),
  askForMediaAccess: vi.fn(),
}));

const sourcesMock = vi.hoisted(() => ({
  getMacScreenPermissionStatus: vi.fn(),
  getSources: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('electron', () => ({
  Notification: {
    isSupported: vi.fn(() => false),
  },
  app: electronMock.app,
  shell: {
    openExternal: electronMock.shellOpenExternal,
  },
  systemPreferences: {
    isTrustedAccessibilityClient: electronMock.isTrustedAccessibilityClient,
    getMediaAccessStatus: electronMock.getMediaAccessStatus,
    askForMediaAccess: electronMock.askForMediaAccess,
  },
}));

vi.mock('../sources/service', () => ({
  getMacScreenPermissionStatus: sourcesMock.getMacScreenPermissionStatus,
  getSources: sourcesMock.getSources,
}));

vi.mock('../library/service', () => ({
  initializeLibrary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ffmpeg/index', () => ({
  checkFFmpeg: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger', () => ({
  default: loggerMock,
  getLogFilePath: vi.fn(() => '/tmp/screenforge.log'),
  writeRendererDiagnostic: vi.fn(),
}));

vi.mock('../../lib/telemetry', () => ({
  trackEvent: vi.fn(),
  initTelemetry: vi.fn(),
  shutdownTelemetry: vi.fn(),
}));

async function loadServiceModule() {
  return import('./service');
}

describe('app permission service', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: 'darwin',
    });

    sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('granted');
    sourcesMock.getSources.mockResolvedValue([]);
    electronMock.getMediaAccessStatus.mockReturnValue('granted');
    electronMock.askForMediaAccess.mockResolvedValue(true);
    electronMock.isTrustedAccessibilityClient.mockImplementation((prompt: boolean) => !prompt);
  });

  it('opens Screen Recording settings once on the first blocked attempt', async () => {
    sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('denied');
    electronMock.isTrustedAccessibilityClient.mockReturnValue(false);

    const { prepareRecordingStartPermissions } = await loadServiceModule();

    await expect(prepareRecordingStartPermissions()).rejects.toThrow(
      SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
    );

    expect(electronMock.shellOpenExternal).toHaveBeenCalledOnce();
    expect(electronMock.shellOpenExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
    expect(electronMock.isTrustedAccessibilityClient).not.toHaveBeenCalledWith(true);
  });

  it('does not reopen Screen Recording settings on repeated blocked attempts', async () => {
    sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('denied');
    electronMock.isTrustedAccessibilityClient.mockReturnValue(false);

    const { prepareRecordingStartPermissions } = await loadServiceModule();

    await expect(prepareRecordingStartPermissions()).rejects.toThrow(
      SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
    );
    await expect(prepareRecordingStartPermissions()).rejects.toThrow(
      SCREEN_RECORDING_PERMISSION_RESTART_REQUIRED_MESSAGE,
    );

    expect(electronMock.shellOpenExternal).toHaveBeenCalledOnce();
  });

  it('prompts for Accessibility once without opening System Settings', async () => {
    sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('granted');
    electronMock.isTrustedAccessibilityClient.mockImplementation(() => false);

    const { prepareRecordingStartPermissions } = await loadServiceModule();

    await expect(prepareRecordingStartPermissions()).rejects.toThrow(
      ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE,
    );

    expect(electronMock.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
    expect(electronMock.shellOpenExternal).not.toHaveBeenCalled();
  });

  it('does not re-prompt Accessibility or reopen settings on repeated blocked attempts', async () => {
    sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('granted');
    electronMock.isTrustedAccessibilityClient.mockImplementation(() => false);

    const { prepareRecordingStartPermissions } = await loadServiceModule();

    await expect(prepareRecordingStartPermissions()).rejects.toThrow(
      ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE,
    );
    await expect(prepareRecordingStartPermissions()).rejects.toThrow(
      ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE,
    );

    const promptCalls = electronMock.isTrustedAccessibilityClient.mock.calls.filter(
      ([prompt]) => prompt === true,
    );
    expect(promptCalls).toHaveLength(1);
    expect(electronMock.shellOpenExternal).not.toHaveBeenCalled();
  });

  it('uses the recent successful preflight cache so the recording-service recheck stays passive', async () => {
    sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('granted');
    electronMock.isTrustedAccessibilityClient.mockImplementation(() => true);

    const { prepareRecordingStartPermissions, prepareRecordingStartPermissionsIfNeeded } =
      await loadServiceModule();

    await expect(prepareRecordingStartPermissions()).resolves.toBeUndefined();
    await expect(prepareRecordingStartPermissionsIfNeeded()).resolves.toBeUndefined();

    expect(sourcesMock.getMacScreenPermissionStatus).toHaveBeenCalledTimes(1);
    expect(electronMock.shellOpenExternal).not.toHaveBeenCalled();
  });

  it('keeps the recording-service recheck read-only when permissions are missing', async () => {
    sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('denied');
    electronMock.isTrustedAccessibilityClient.mockImplementation(() => false);

    const { prepareRecordingStartPermissionsIfNeeded } = await loadServiceModule();

    await expect(prepareRecordingStartPermissionsIfNeeded()).rejects.toThrow(
      SCREEN_RECORDING_PERMISSION_RESTART_REQUIRED_MESSAGE,
    );

    expect(electronMock.shellOpenExternal).not.toHaveBeenCalled();
    expect(electronMock.isTrustedAccessibilityClient).not.toHaveBeenCalledWith(true);
  });

  describe('on Linux', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'linux',
      });
    });

    it('reports startup permissions without touching systemPreferences', async () => {
      sourcesMock.getSources.mockResolvedValue([
        { id: 'screen:0', name: 'Entire screen', thumbnail: null, appIcon: null },
      ]);

      const { getStartupPermissionStatuses } = await loadServiceModule();

      await expect(getStartupPermissionStatuses()).resolves.toEqual({
        screen: 'granted',
        microphone: 'granted',
        camera: 'granted',
        accessibility: 'granted',
      });

      // These Electron APIs do not exist on Linux — calling them would throw.
      expect(electronMock.getMediaAccessStatus).not.toHaveBeenCalled();
      expect(electronMock.isTrustedAccessibilityClient).not.toHaveBeenCalled();
      expect(sourcesMock.getMacScreenPermissionStatus).not.toHaveBeenCalled();
    });

    it('grants media access requests without a native prompt', async () => {
      const { requestMediaAccess } = await loadServiceModule();

      await expect(requestMediaAccess('microphone')).resolves.toBe('granted');
      await expect(requestMediaAccess('camera')).resolves.toBe('granted');

      expect(electronMock.askForMediaAccess).not.toHaveBeenCalled();
      expect(electronMock.getMediaAccessStatus).not.toHaveBeenCalled();
    });

    it('grants accessibility without prompting', async () => {
      const { requestAccessibilityAccess } = await loadServiceModule();

      await expect(requestAccessibilityAccess()).resolves.toBe('granted');
      expect(electronMock.isTrustedAccessibilityClient).not.toHaveBeenCalled();
    });

    it('lets recording-start permission preparation pass through as a no-op', async () => {
      const { prepareRecordingStartPermissions } = await loadServiceModule();

      await expect(prepareRecordingStartPermissions()).resolves.toBeUndefined();
      expect(electronMock.shellOpenExternal).not.toHaveBeenCalled();
    });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
  });
});
