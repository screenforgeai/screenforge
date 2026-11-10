import type {
  GuidedPermission,
  RecordingPermissionsState,
  StartupPermissionStatus,
} from '../types';

export const GUIDED_PERMISSIONS: readonly GuidedPermission[] = ['screen', 'accessibility'];

/**
 * How often the open guide re-reads the permission state. Each screen read
 * spawns the native helper, so keep it at human speed rather than per frame.
 */
export const PERMISSION_POLL_INTERVAL_MS = 1500;

export type PermissionCardStatus = 'granted' | 'missing' | 'waiting';

export function getMissingGuidedPermissions(state: RecordingPermissionsState): GuidedPermission[] {
  if (!state.required) {
    return [];
  }
  return GUIDED_PERMISSIONS.filter((permission) => state[permission] !== 'granted');
}

export function shouldShowPermissionsGuideOnLaunch(
  state: RecordingPermissionsState,
  dismissed: boolean,
): boolean {
  return !dismissed && getMissingGuidedPermissions(state).length > 0;
}

/**
 * `waiting` means the user has been sent to System Settings but the OS does
 * not report the grant yet. macOS often only applies Screen Recording after a
 * relaunch, so that is when the guide offers Quit & Reopen.
 */
export function getPermissionCardStatus(
  status: StartupPermissionStatus,
  settingsOpened: boolean,
): PermissionCardStatus {
  if (status === 'granted') {
    return 'granted';
  }
  return settingsOpened ? 'waiting' : 'missing';
}

export interface PermissionPoller {
  /** Read now, unless a read is already in flight. */
  refresh: () => Promise<void>;
  stop: () => void;
}

/**
 * Reads right away and then every `intervalMs` until stopped. Reads never
 * overlap, failed reads are skipped, and nothing is reported after stop().
 */
export function createPermissionPoller(
  read: () => Promise<RecordingPermissionsState>,
  onUpdate: (state: RecordingPermissionsState) => void,
  intervalMs = PERMISSION_POLL_INTERVAL_MS,
): PermissionPoller {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (stopped) {
      return;
    }
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, intervalMs);
  };

  const refresh = (): Promise<void> => {
    if (stopped) {
      return Promise.resolve();
    }
    if (inFlight) {
      return inFlight;
    }
    inFlight = read()
      .then(
        (state) => {
          if (!stopped) {
            onUpdate(state);
          }
        },
        () => undefined,
      )
      .finally(() => {
        inFlight = null;
        schedule();
      });
    return inFlight;
  };

  void refresh();

  return {
    refresh,
    stop: () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
