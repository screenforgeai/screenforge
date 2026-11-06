import type { StartupPermissionStatus } from '../types';

// Shown as a system notification when a recording is blocked. The main window
// opens the permissions guide at the same time, which has the actual steps.
export const SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE =
  'Screen Recording permission is required before you start. Follow the permissions guide in the Screenforge window to turn it on.';

export const ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE =
  'Accessibility permission is required for cursor tracking. Follow the permissions guide in the Screenforge window to turn it on.';

export interface RecordingStartPermissionAPI {
  getScreenPermissionStatus: () => Promise<StartupPermissionStatus>;
  getAccessibilityPermissionStatus: () =>
    | Promise<StartupPermissionStatus>
    | StartupPermissionStatus;
}

/**
 * Read-only check before a recording starts. It never prompts or opens System
 * Settings: when something is missing, the permissions guide takes over.
 */
export async function ensureRecordingStartPermissions(
  api: RecordingStartPermissionAPI,
): Promise<void> {
  const screenStatus = await api.getScreenPermissionStatus();
  if (screenStatus !== 'granted') {
    throw new Error(SCREEN_RECORDING_PERMISSION_REQUIRED_MESSAGE);
  }

  const accessibilityStatus = await api.getAccessibilityPermissionStatus();
  if (accessibilityStatus !== 'granted') {
    throw new Error(ACCESSIBILITY_PERMISSION_REQUIRED_MESSAGE);
  }
}
