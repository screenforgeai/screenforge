import type { BrowserWindow } from 'electron';
import { CH } from '../../channels';
import log from '../../lib/logger';
import type {
  ScreenshotCaptureData,
  ScreenshotCaptureRequest,
  SelectedArea,
} from '../../../src/types/index';
import { WAYLAND_PICKED_SCREEN_ID } from '../../../src/lib/recording/waylandPicker';
import { closeCameraPreview } from '../camera-preview/service';
import { captureStill, cropPng } from './service';

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

  openInEditor(capture, toolbar, { getMainWindow, getToolbarWindow, setToolbarWindow });
}

/** Sends a still to the main window's Screenshot editor and closes the toolbar it came from. */
function openInEditor(
  capture: ScreenshotCaptureData,
  toolbar: BrowserWindow | null,
  { getMainWindow, getToolbarWindow, setToolbarWindow }: ScreenshotWindows,
): void {
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
  // A toolbar opened while the still was being taken isn't ours to forget.
  if (getToolbarWindow() === toolbar) {
    setToolbarWindow(null);
  }
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

/** True from the shortcut press until the screenshot opens, is cancelled or fails. */
export function isAreaScreenshotInFlight(): boolean {
  return areaScreenshotInFlight;
}

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
    let area;
    try {
      area = await deps.selectArea();
    } catch (error) {
      log.error('[screenshot] shortcut: area selector failed', { error });
      deps.warn(SCREENSHOT_FAILED_MESSAGE);
      restoreMainWindow();
      return 'failed';
    }
    if (!area) {
      restoreMainWindow();
      return 'cancelled';
    }
    // A recording may have started while the area was drawn: capturing now
    // would close its toolbar out from under it.
    if (deps.isBusy()) {
      restoreMainWindow();
      return 'skipped';
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

export type PickedAreaScreenshotDeps = Omit<AreaScreenshotDeps, 'selectArea'> & {
  /** Shows the still to draw an area on; the area in the still's pixels, null when cancelled. */
  selectAreaOnStill: (still: ScreenshotCaptureData) => Promise<SelectedArea | null>;
};

/**
 * Wayland's area screenshot: the screen is picked in the system share dialog first, then the
 * area is drawn on a still of it. Apps there cannot place an overlay on a chosen monitor, so
 * drawing on the live screen could land on the wrong one; a still can be shown anywhere.
 */
export async function takePickedAreaScreenshot(
  deps: PickedAreaScreenshotDeps,
): Promise<AreaScreenshotResult> {
  if (areaScreenshotInFlight || deps.isBusy()) {
    return 'skipped';
  }
  areaScreenshotInFlight = true;

  const mainWindow = deps.getMainWindow();
  const mainWasVisible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  const toolbar = deps.getToolbarWindow();
  const restore = () => {
    if (toolbar && !toolbar.isDestroyed()) {
      toolbar.show();
    }
    if (mainWasVisible && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  };

  try {
    try {
      await deps.preparePermissions();
    } catch (error) {
      log.warn('[screenshot] picked area: permissions not ready', { error });
      deps.warn(error instanceof Error ? error.message : SCREENSHOT_FAILED_MESSAGE);
      return 'failed';
    }

    if (mainWasVisible) {
      mainWindow.hide();
    }
    toolbar?.hide();
    closeCameraPreview();
    await new Promise((resolve) => setTimeout(resolve, HIDE_SETTLE_MS));

    let still: ScreenshotCaptureData;
    try {
      still = await captureStill({ kind: 'display', sourceId: WAYLAND_PICKED_SCREEN_ID });
    } catch (error) {
      restore();
      // Closing the share dialog returns no screen: that is a cancel, not a failure.
      if (error instanceof Error && error.message.startsWith('No image available')) {
        log.info('[screenshot] picked area: share dialog closed');
        return 'cancelled';
      }
      log.error('[screenshot] picked area: capture failed', { error });
      deps.warn(SCREENSHOT_FAILED_MESSAGE);
      return 'failed';
    }

    let area: SelectedArea | null;
    try {
      area = await deps.selectAreaOnStill(still);
    } catch (error) {
      log.error('[screenshot] picked area: selector failed', { error });
      restore();
      deps.warn(SCREENSHOT_FAILED_MESSAGE);
      return 'failed';
    }
    if (!area) {
      restore();
      return 'cancelled';
    }
    if (deps.isBusy()) {
      restore();
      return 'skipped';
    }

    try {
      const cropped = cropPng(still.png, area);
      openInEditor(
        {
          kind: 'area',
          png: cropped.png,
          width: cropped.width,
          height: cropped.height,
          scaleFactor: still.scaleFactor,
        },
        toolbar,
        deps,
      );
      return 'taken';
    } catch (error) {
      log.error('[screenshot] picked area: could not open the still', { error });
      restore();
      deps.warn(SCREENSHOT_FAILED_MESSAGE);
      return 'failed';
    }
  } finally {
    areaScreenshotInFlight = false;
  }
}
