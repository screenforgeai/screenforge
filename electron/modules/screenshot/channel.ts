import type { BrowserWindow } from 'electron';
import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import log from '../../lib/logger';
import type { ScreenshotCaptureRequest } from '../../../src/types/index';
import { closeCameraPreview } from '../camera-preview/service';
import { captureStill, copyImageToClipboard } from './service';

// Time for the compositor to drop the hidden toolbar / area selector from the
// screen before the still is grabbed.
const HIDE_SETTLE_MS = 250;

const CAPTURE_KINDS = new Set(['display', 'window', 'area']);

// Renderer input: the request type is not enforced at runtime.
function isValidCaptureRequest(request: unknown): request is ScreenshotCaptureRequest {
  const r = request as Partial<ScreenshotCaptureRequest> | null;
  if (!r || typeof r.sourceId !== 'string' || !CAPTURE_KINDS.has(r.kind as string)) {
    return false;
  }
  if (r.kind !== 'area') {
    return true;
  }
  const a = r.area;
  return !!a && [a.x, a.y, a.width, a.height].every(Number.isFinite) && a.width > 0 && a.height > 0;
}

type Options = {
  getMainWindow: () => BrowserWindow | null;
  getToolbarWindow: () => BrowserWindow | null;
  setToolbarWindow: (window: BrowserWindow | null) => void;
};

export function registerScreenshotChannels({
  getMainWindow,
  getToolbarWindow,
  setToolbarWindow,
}: Options): void {
  handleChannel<[ScreenshotCaptureRequest], void>(CH.screenshot.CAPTURE, async (request) => {
    if (!isValidCaptureRequest(request)) {
      throw new Error('Invalid screenshot capture request');
    }
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
  });

  handleChannel<[string], void>(CH.screenshot.COPY, (dataUrl) => copyImageToClipboard(dataUrl));
}
