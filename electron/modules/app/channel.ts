import { app } from 'electron';
import { CH } from '../../channels';
import { handleChannel, listenChannel } from '../../lib/ipc-main';
import type { FeedbackSubmission, SerializedError } from '../../../src/types/index';
import {
  captureException,
  getAppVersion,
  getAnonymousId,
  identifyUser,
  submitFeedback,
  getDiagnosticLogFilePath,
  readDiagnosticLog,
  prepareRecordingStartPermissions,
  prepareScreenshotPermissions,
  requestScreenAccess,
  focusWindow,
  getStartupPermissionStatuses,
  openSystemSettings,
  openExternalUrl,
  relaunchApp,
  requestMediaAccess,
  showSystemWarning,
  trackAnalyticsEvent,
  writeDiagnosticLog,
  saveScreenshot,
  saveMusic,
} from './service';

export function registerAppChannels(): void {
  listenChannel(CH.app.QUIT, () => app.quit());
  listenChannel(CH.app.RELAUNCH, () => relaunchApp());
  listenChannel<[string]>(CH.app.SYSTEM_WARNING, (message) => showSystemWarning(message));
  handleChannel<[], string>(CH.app.GET_APP_VERSION, () => getAppVersion());
  handleChannel(CH.app.PREPARE_RECORDING_START_PERMISSIONS, () =>
    prepareRecordingStartPermissions(),
  );
  handleChannel(CH.app.PREPARE_SCREENSHOT_PERMISSIONS, () => prepareScreenshotPermissions());
  handleChannel(CH.app.GET_STARTUP_PERMISSION_STATUSES, () => getStartupPermissionStatuses());
  handleChannel(CH.app.REQUEST_SCREEN_ACCESS, () => requestScreenAccess());
  handleChannel(CH.app.REQUEST_MEDIA_ACCESS, (permission) => requestMediaAccess(permission));
  handleChannel<[], string>(CH.app.GET_LOG_FILE_PATH, () => getDiagnosticLogFilePath());
  handleChannel<[], string>(CH.app.READ_LOG_FILE, () => readDiagnosticLog());
  listenChannel<[string, unknown?]>(CH.app.WRITE_DIAGNOSTIC_LOG, (scope, payload) => {
    writeDiagnosticLog(scope, payload);
  });
  listenChannel<[string]>(CH.app.OPEN_EXTERNAL_URL, (url) => {
    void openExternalUrl(url);
  });
  listenChannel<[Parameters<typeof openSystemSettings>[0]]>(
    CH.app.OPEN_SYSTEM_SETTINGS,
    (permission) => {
      void openSystemSettings(permission);
    },
  );
  listenChannel<[Parameters<typeof focusWindow>[0]]>(CH.app.FOCUS_WINDOW, (target) => {
    void focusWindow(target);
  });
  listenChannel<[string, Record<string, unknown>?]>(CH.app.TRACK_EVENT, (event, properties) => {
    trackAnalyticsEvent(event, properties);
  });
  handleChannel<[], string | null>(CH.app.GET_ANONYMOUS_ID, () => getAnonymousId());
  listenChannel<[{ name?: string; email?: string }]>(CH.app.IDENTIFY_USER, ({ name, email }) => {
    identifyUser(name, email);
  });
  listenChannel<[SerializedError, Record<string, unknown>?]>(
    CH.app.CAPTURE_EXCEPTION,
    (error, properties) => {
      captureException(error, properties);
    },
  );
  listenChannel<[FeedbackSubmission]>(CH.app.SUBMIT_FEEDBACK, (feedback) => {
    submitFeedback(feedback);
  });
  handleChannel<[Uint8Array], string>(CH.app.SAVE_SCREENSHOT, (png) => saveScreenshot(png));
  handleChannel<[string, string], { filePath: string; duration: number }>(
    CH.music.SAVE,
    (srcPath, projectId) => saveMusic(srcPath, projectId),
  );
}
