import type { StartupPermission, StartupPermissionStatus } from '../types';

export const SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE =
  'Screen Recording permission is required before you start. System Settings has been opened. After enabling it, quit and reopen Screenforge.';

export const ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE =
  'Accessibility permission is required for cursor tracking. Approve the macOS prompt, then quit and reopen Screenforge.';

export const SCREEN_RECORDING_PERMISSION_RESTART_REQUIRED_MESSAGE =
  'Screen Recording permission is still pending. Quit and reopen Screenforge if it is already enabled in System Settings.';

export const ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE =
  'Accessibility permission is still pending. Quit and reopen Screenforge if it is already enabled in System Settings.';

export interface RecordingStartPermissionAPI {
  requestScreenAccess: () => Promise<StartupPermissionStatus>;
  getAccessibilityPermissionStatus: () =>
    | Promise<StartupPermissionStatus>
    | StartupPermissionStatus;
  requestAccessibilityAccess: () => Promise<StartupPermissionStatus>;
  openSystemSettings: (permission: StartupPermission) => Promise<boolean | void> | boolean | void;
}

export async function ensureRecordingStartPermissions(
  api: RecordingStartPermissionAPI,
): Promise<void> {
  const screenStatus = await api.requestScreenAccess();
  if (screenStatus !== 'granted') {
    const opened = (await api.openSystemSettings('screen')) !== false;
    throw new Error(
      opened
        ? SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE
        : SCREEN_RECORDING_PERMISSION_RESTART_REQUIRED_MESSAGE,
    );
  }

  const accessibilityStatus = await api.getAccessibilityPermissionStatus();
  if (accessibilityStatus === 'granted') {
    return;
  }

  const nextAccessibilityStatus = await api.requestAccessibilityAccess();
  if (nextAccessibilityStatus === 'granted') {
    return;
  }

  throw new Error(ACCESSIBILITY_PERMISSION_RESTART_REQUIRED_MESSAGE);
}
