import { describe, expect, it, vi } from 'vitest';
import {
  ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE,
  ensureRecordingStartPermissions,
  SCREEN_RECORDING_PERMISSION_RESTART_REQUIRED_MESSAGE,
  SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
  type RecordingStartPermissionAPI,
} from './recordingStartPermissions';

function createPermissionApi(
  overrides: Partial<RecordingStartPermissionAPI> = {},
): RecordingStartPermissionAPI {
  return {
    requestScreenAccess: vi.fn().mockResolvedValue('granted'),
    getAccessibilityPermissionStatus: vi.fn().mockResolvedValue('granted'),
    requestAccessibilityAccess: vi.fn().mockResolvedValue('granted'),
    openSystemSettings: vi.fn(),
    ...overrides,
  };
}

describe('ensureRecordingStartPermissions', () => {
  it('returns when screen and accessibility permissions are already granted', async () => {
    const api = createPermissionApi();

    await expect(ensureRecordingStartPermissions(api)).resolves.toBeUndefined();

    expect(api.requestScreenAccess).toHaveBeenCalledOnce();
    expect(api.getAccessibilityPermissionStatus).toHaveBeenCalledOnce();
    expect(api.requestAccessibilityAccess).not.toHaveBeenCalled();
    expect(api.openSystemSettings).not.toHaveBeenCalled();
  });

  it('opens screen settings and throws when screen access is still missing', async () => {
    const api = createPermissionApi({
      requestScreenAccess: vi.fn().mockResolvedValue('denied'),
    });

    await expect(ensureRecordingStartPermissions(api)).rejects.toThrow(
      SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
    );

    expect(api.openSystemSettings).toHaveBeenCalledWith('screen');
    expect(api.getAccessibilityPermissionStatus).not.toHaveBeenCalled();
    expect(api.requestAccessibilityAccess).not.toHaveBeenCalled();
  });

  it('uses the restart message when screen settings were already opened earlier in the session', async () => {
    const api = createPermissionApi({
      requestScreenAccess: vi.fn().mockResolvedValue('denied'),
      openSystemSettings: vi.fn().mockResolvedValue(false),
    });

    await expect(ensureRecordingStartPermissions(api)).rejects.toThrow(
      SCREEN_RECORDING_PERMISSION_RESTART_REQUIRED_MESSAGE,
    );
  });

  it('requests accessibility after screen access succeeds', async () => {
    const api = createPermissionApi({
      getAccessibilityPermissionStatus: vi.fn().mockResolvedValue('not-determined'),
      requestAccessibilityAccess: vi.fn().mockResolvedValue('granted'),
    });

    await expect(ensureRecordingStartPermissions(api)).resolves.toBeUndefined();

    expect(api.requestAccessibilityAccess).toHaveBeenCalledOnce();
    expect(api.openSystemSettings).not.toHaveBeenCalled();
  });

  it('throws the restart message when accessibility stays unavailable after the prompt path', async () => {
    const api = createPermissionApi({
      getAccessibilityPermissionStatus: vi.fn().mockResolvedValue('not-determined'),
      requestAccessibilityAccess: vi.fn().mockResolvedValue('not-determined'),
    });

    await expect(ensureRecordingStartPermissions(api)).rejects.toThrow(
      ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE,
    );

    expect(api.openSystemSettings).not.toHaveBeenCalled();
  });

  it('does not try to open accessibility settings on repeated blocked attempts', async () => {
    const api = createPermissionApi({
      getAccessibilityPermissionStatus: vi.fn().mockResolvedValue('not-determined'),
      requestAccessibilityAccess: vi.fn().mockResolvedValue('not-determined'),
      openSystemSettings: vi.fn().mockResolvedValue(false),
    });

    await expect(ensureRecordingStartPermissions(api)).rejects.toThrow(
      ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE,
    );

    expect(api.openSystemSettings).not.toHaveBeenCalled();
  });
});
