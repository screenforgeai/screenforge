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
    toolbar?.close();
    setToolbarWindow(null);
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send(CH.screenshot.CAPTURED, capture);
    mainWindow?.show();
    mainWindow?.focus();
  });

  handleChannel<[string], void>(CH.screenshot.COPY, (dataUrl) => copyImageToClipboard(dataUrl));
}
