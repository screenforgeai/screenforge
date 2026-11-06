// @vitest-environment node

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE,
  SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
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
  requestMacScreenCaptureAccess: vi.fn(),
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
  requestMacScreenCaptureAccess: sourcesMock.requestMacScreenCaptureAccess,
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

  it('refuses to start without Screen Recording and leaves the next step to the guide', async () => {
    sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('denied');
    electronMock.isTrustedAccessibilityClient.mockReturnValue(false);

    const { prepareRecordingStartPermissions } = await loadServiceModule();

    await expect(prepareRecordingStartPermissions()).rejects.toThrow(
      SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
    );

    expect(electronMock.shellOpenExternal).not.toHaveBeenCalled();
    expect(electronMock.isTrustedAccessibilityClient).not.toHaveBeenCalledWith(true);
  });

  it('refuses to start without Accessibility and does not raise the raw macOS prompt', async () => {
    sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('granted');
    electronMock.isTrustedAccessibilityClient.mockImplementation(() => false);

    const { prepareRecordingStartPermissions } = await loadServiceModule();

    await expect(prepareRecordingStartPermissions()).rejects.toThrow(
      ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE,
    );

    expect(electronMock.isTrustedAccessibilityClient).not.toHaveBeenCalledWith(true);
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
      SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
    );

    expect(electronMock.shellOpenExternal).not.toHaveBeenCalled();
    expect(electronMock.isTrustedAccessibilityClient).not.toHaveBeenCalledWith(true);
  });

  describe('permissions guide', () => {
    it('reports both permissions as required on macOS', async () => {
      sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('denied');
      electronMock.isTrustedAccessibilityClient.mockReturnValue(false);

      const { getRecordingPermissions } = await loadServiceModule();

      await expect(getRecordingPermissions()).resolves.toEqual({
        required: true,
        screen: 'denied',
        accessibility: 'not-determined',
      });
    });

    it('picks up a grant on the next read without a relaunch', async () => {
      sourcesMock.getMacScreenPermissionStatus
        .mockResolvedValueOnce('denied')
        .mockResolvedValueOnce('granted');
      electronMock.isTrustedAccessibilityClient
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const { getRecordingPermissions } = await loadServiceModule();

      await expect(getRecordingPermissions()).resolves.toMatchObject({
        screen: 'denied',
        accessibility: 'not-determined',
      });
      await expect(getRecordingPermissions()).resolves.toMatchObject({
        screen: 'granted',
        accessibility: 'granted',
      });
      // Polling reads must stay passive: never a system prompt.
      expect(electronMock.isTrustedAccessibilityClient).not.toHaveBeenCalledWith(true);
    });

    it('registers Screenforge for Screen Recording, then opens that pane', async () => {
      sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('not-determined');

      const { openPermissionSettings } = await loadServiceModule();
      await openPermissionSettings('screen');

      expect(sourcesMock.requestMacScreenCaptureAccess).toHaveBeenCalledOnce();
      expect(electronMock.shellOpenExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
    });

    it('opens the Screen Recording pane without re-requesting once access is granted', async () => {
      sourcesMock.getMacScreenPermissionStatus.mockResolvedValue('granted');

      const { openPermissionSettings } = await loadServiceModule();
      await openPermissionSettings('screen');

      expect(sourcesMock.requestMacScreenCaptureAccess).not.toHaveBeenCalled();
      expect(electronMock.shellOpenExternal).toHaveBeenCalledOnce();
    });

    it('registers Screenforge for Accessibility once, and opens that pane every time', async () => {
      electronMock.isTrustedAccessibilityClient.mockReturnValue(false);

      const { openPermissionSettings } = await loadServiceModule();
      await openPermissionSettings('accessibility');
      await openPermissionSettings('accessibility');

      const promptCalls = electronMock.isTrustedAccessibilityClient.mock.calls.filter(
        ([prompt]) => prompt === true,
      );
      expect(promptCalls).toHaveLength(1);
      expect(electronMock.shellOpenExternal).toHaveBeenCalledTimes(2);
      expect(electronMock.shellOpenExternal).toHaveBeenCalledWith(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      );
    });

    it('relaunches the app so macOS applies a pending Screen Recording grant', async () => {
      const { relaunchApp } = await loadServiceModule();
      relaunchApp();

      expect(electronMock.app.relaunch).toHaveBeenCalledOnce();
      expect(electronMock.app.exit).toHaveBeenCalledWith(0);
    });
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

    it('does not require the macOS-only permissions', async () => {
      const { getRecordingPermissions } = await loadServiceModule();

      await expect(getRecordingPermissions()).resolves.toEqual({
        required: false,
        screen: 'granted',
        accessibility: 'granted',
      });
      expect(electronMock.isTrustedAccessibilityClient).not.toHaveBeenCalled();
      expect(sourcesMock.getMacScreenPermissionStatus).not.toHaveBeenCalled();
    });

    it('never opens a settings pane from the guide', async () => {
      const { openPermissionSettings } = await loadServiceModule();

      await openPermissionSettings('screen');
      await openPermissionSettings('accessibility');

      expect(electronMock.shellOpenExternal).not.toHaveBeenCalled();
      expect(sourcesMock.requestMacScreenCaptureAccess).not.toHaveBeenCalled();
    });

    it('lets recording-start permission preparation pass through as a no-op', async () => {
      const { prepareRecordingStartPermissions } = await loadServiceModule();

      await expect(prepareRecordingStartPermissions()).resolves.toBeUndefined();
      expect(electronMock.shellOpenExternal).not.toHaveBeenCalled();
    });
  });

  describe('on Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: 'win32',
      });
    });

    it('does not require the macOS-only permissions', async () => {
      const { getRecordingPermissions } = await loadServiceModule();

      await expect(getRecordingPermissions()).resolves.toEqual({
        required: false,
        screen: 'granted',
        accessibility: 'granted',
      });
      expect(electronMock.isTrustedAccessibilityClient).not.toHaveBeenCalled();
    });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
  });
});
