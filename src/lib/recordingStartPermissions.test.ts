import { describe, expect, it, vi } from 'vitest';
import {
  ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE,
  ensureRecordingStartPermissions,
  SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
  type RecordingStartPermissionAPI,
} from './recordingStartPermissions';

function createPermissionApi(
  overrides: Partial<RecordingStartPermissionAPI> = {},
): RecordingStartPermissionAPI {
  return {
    getScreenPermissionStatus: vi.fn().mockResolvedValue('granted'),
    getAccessibilityPermissionStatus: vi.fn().mockResolvedValue('granted'),
    ...overrides,
  };
}

describe('ensureRecordingStartPermissions', () => {
  it('returns when screen and accessibility permissions are already granted', async () => {
    const api = createPermissionApi();

    await expect(ensureRecordingStartPermissions(api)).resolves.toBeUndefined();

    expect(api.getScreenPermissionStatus).toHaveBeenCalledOnce();
    expect(api.getAccessibilityPermissionStatus).toHaveBeenCalledOnce();
  });

  it('throws the Screen Recording message when screen access is missing', async () => {
    const api = createPermissionApi({
      getScreenPermissionStatus: vi.fn().mockResolvedValue('denied'),
    });

    await expect(ensureRecordingStartPermissions(api)).rejects.toThrow(
      SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
    );
    expect(api.getAccessibilityPermissionStatus).not.toHaveBeenCalled();
  });

  it('throws the Accessibility message when only accessibility is missing', async () => {
    const api = createPermissionApi({
      getAccessibilityPermissionStatus: vi.fn().mockReturnValue('not-determined'),
    });

    await expect(ensureRecordingStartPermissions(api)).rejects.toThrow(
      ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE,
    );
  });

  it('points to the in-app guide instead of asking for a manual restart', () => {
    for (const message of [
      SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE,
      ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE,
    ]) {
      expect(message).not.toMatch(/quit and reopen/i);
      expect(message).toMatch(/guide/i);
    }
  });
});
