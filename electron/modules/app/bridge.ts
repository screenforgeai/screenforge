import { CH } from '../../channels';
import { createInvokeBridge, createSendBridge, createSubscription } from '../../lib/ipc-renderer';
import type {
  PreloadProgress,
  RequestableMediaPermission,
  StartupPermission,
  StartupPermissionMap,
  StartupPermissionStatus,
  ToolbarShapeRect,
  ToolbarViewportMode,
  WindowFocusTarget,
} from '../../../src/types/index';

export const appBridge = {
  onPreloadProgress: createSubscription<PreloadProgress>(CH.preload.PROGRESS),
  getAppVersion: createInvokeBridge<[], string>(CH.app.GET_APP_VERSION),
  prepareRecordingStartPermissions: createInvokeBridge<[], void>(
    CH.app.PREPARE_RECORDING_START_PERMISSIONS,
  ),
  getStartupPermissionStatuses: createInvokeBridge<[], StartupPermissionMap>(
    CH.app.GET_STARTUP_PERMISSION_STATUSES,
  ),
  requestScreenAccess: createInvokeBridge<[], StartupPermissionStatus>(
    CH.app.REQUEST_SCREEN_ACCESS,
  ),
  requestMediaAccess: createInvokeBridge<[RequestableMediaPermission], StartupPermissionStatus>(
    CH.app.REQUEST_MEDIA_ACCESS,
  ),
  getLogFilePath: createInvokeBridge<[], string>(CH.app.GET_LOG_FILE_PATH),
  readLogFile: createInvokeBridge<[], string>(CH.app.READ_LOG_FILE),
  writeDiagnosticLog: createSendBridge<[string, unknown?]>(CH.app.WRITE_DIAGNOSTIC_LOG),
  relaunchApp: createSendBridge<[]>(CH.app.RELAUNCH),
  openExternalUrl: createSendBridge<[string]>(CH.app.OPEN_EXTERNAL_URL),
  openSystemSettings: createSendBridge<[StartupPermission]>(CH.app.OPEN_SYSTEM_SETTINGS),
  quitApp: createSendBridge<[]>(CH.app.QUIT),
  minimizeToDock: createSendBridge<[]>(CH.app.MINIMIZE_TO_DOCK),
  focusWindow: createSendBridge<[WindowFocusTarget]>(CH.app.FOCUS_WINDOW),
  setToolbarMouseInteractivity: createSendBridge<[boolean]>(CH.app.SET_TOOLBAR_MOUSE_INTERACTIVITY),
  setToolbarShape: createSendBridge<[ToolbarShapeRect[]]>(CH.app.SET_TOOLBAR_SHAPE),
  setToolbarViewport: createSendBridge<[ToolbarViewportMode]>(CH.app.SET_TOOLBAR_VIEWPORT),
  showMain: createSendBridge<[]>(CH.app.SHOW_MAIN),
  showToolbar: createSendBridge<[]>(CH.app.SHOW_TOOLBAR),
  systemWarning: createSendBridge<[string]>(CH.app.SYSTEM_WARNING),
  trackEvent: createSendBridge<[string, Record<string, unknown>?]>(CH.app.TRACK_EVENT),
  getAnonymousId: createInvokeBridge<[], string | null>(CH.app.GET_ANONYMOUS_ID),
  identifyUser: createSendBridge<[{ name?: string; email?: string }]>(CH.app.IDENTIFY_USER),
  saveScreenshot: createInvokeBridge<[string], string>(CH.app.SAVE_SCREENSHOT),
  saveMusic: createInvokeBridge<[string, string], { filePath: string; duration: number }>(
    CH.music.SAVE,
  ),
};
