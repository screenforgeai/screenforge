import type { BrowserWindow } from 'electron';
import { CH } from '../../channels';
import log from '../../lib/logger';
import type { ScreenshotCaptureRequest, SelectedArea } from '../../../src/types/index';
import { closeCameraPreview } from '../camera-preview/service';
import { captureStill } from './service';

// Time for the compositor to drop the hidden toolbar / area selector from the
// screen before the still is grabbed.
const HIDE_SETTLE_MS = 250;

export const SCREENSHOT_FAILED_MESSAGE =
  "Couldn't take the screenshot. Check the screen recording permission and try again.";

export type ScreenshotWindows = {
  getMainWindow: () => BrowserWindow | null;
  getToolbarWindow: () => BrowserWindow | null;
  setToolbarWindow: (window: BrowserWindow | null) => void;
};

/**
 * Hides the toolbar, grabs the still and opens it in the main window's
 * Screenshot editor. On failure the toolbar comes back and the error is rethrown.
 */
export async function captureAndOpenEditor(
  request: ScreenshotCaptureRequest,
  { getMainWindow, getToolbarWindow, setToolbarWindow }: ScreenshotWindows,
): Promise<void> {
  const toolbar = getToolbarWindow();
  toolbar?.hide();
  closeCameraPreview();
  await new Promise((resolve) => setTimeout(resolve, HIDE_SETTLE_MS));

  let capture;
  try {
    capture = await captureStill(request);
  } catch (error) {
    log.error('[screenshot] capture failed', { kind: request.kind, error });
    toolbar?.show();
    throw error;
  }

  log.info('[screenshot] captured', {
    kind: capture.kind,
    width: capture.width,
    height: capture.height,
  });
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    // Keep the toolbar, so the renderer can show its capture-failed warning.
    toolbar?.show();
    throw new Error('Main window is not available to open the Screenshot editor');
  }
  toolbar?.close();
  setToolbarWindow(null);
  mainWindow.webContents.send(CH.screenshot.CAPTURED, capture);
  mainWindow.show();
  mainWindow.focus();
}

export type AreaScreenshotDeps = ScreenshotWindows & {
  /** True while a recording is starting, running or being saved. */
  isBusy: () => boolean;
  preparePermissions: () => Promise<void>;
  /** Opens the area selector; null when the user cancels. */
  selectArea: () => Promise<SelectedArea | null>;
  warn: (message: string) => void;
};

export type AreaScreenshotResult = 'taken' | 'cancelled' | 'skipped' | 'failed';

let areaScreenshotInFlight = false;

/**
 * The screenshot shortcut: select an area, capture it and open the editor,
 * without going through the toolbar. The main window steps aside while the
 * area is drawn and comes back if nothing is captured.
 */
export async function takeAreaScreenshot(deps: AreaScreenshotDeps): Promise<AreaScreenshotResult> {
  if (areaScreenshotInFlight || deps.isBusy()) {
    return 'skipped';
  }
  areaScreenshotInFlight = true;

  const mainWindow = deps.getMainWindow();
  const mainWasVisible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  const restoreMainWindow = () => {
    if (mainWasVisible && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  };

  try {
    try {
      await deps.preparePermissions();
    } catch (error) {
      log.warn('[screenshot] shortcut: permissions not ready', { error });
      deps.warn(error instanceof Error ? error.message : SCREENSHOT_FAILED_MESSAGE);
      return 'failed';
    }

    if (mainWasVisible) {
      mainWindow.hide();
    }
    const area = await deps.selectArea();
    if (!area) {
      restoreMainWindow();
      return 'cancelled';
    }

    try {
      // An area is matched to its display by id, so the source id is only a fallback.
      await captureAndOpenEditor({ kind: 'area', sourceId: 'screen:0', area }, deps);
      return 'taken';
    } catch {
      deps.warn(SCREENSHOT_FAILED_MESSAGE);
      restoreMainWindow();
      return 'failed';
    }
  } finally {
    areaScreenshotInFlight = false;
  }
}
