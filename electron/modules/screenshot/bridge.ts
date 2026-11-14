import { CH } from '../../channels';
import { createInvokeBridge, createSubscription } from '../../lib/ipc-renderer';
import type {
  ScreenshotCaptureData,
  ScreenshotCaptureOutcome,
  ScreenshotCaptureRequest,
} from '../../../src/types/index';

export const screenshotBridge = {
  captureScreenshot: createInvokeBridge<[ScreenshotCaptureRequest], ScreenshotCaptureOutcome>(
    CH.screenshot.CAPTURE,
  ),
  copyScreenshotToClipboard: createInvokeBridge<[Uint8Array], void>(CH.screenshot.COPY),
  takeScreenshot: createInvokeBridge<[], void>(CH.screenshot.TAKE_AREA),
  onScreenshotCaptured: createSubscription<ScreenshotCaptureData>(CH.screenshot.CAPTURED),
};
