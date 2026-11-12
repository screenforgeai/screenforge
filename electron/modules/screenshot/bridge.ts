import { CH } from '../../channels';
import { createInvokeBridge, createSubscription } from '../../lib/ipc-renderer';
import type { ScreenshotCaptureData, ScreenshotCaptureRequest } from '../../../src/types/index';

export const screenshotBridge = {
  captureScreenshot: createInvokeBridge<[ScreenshotCaptureRequest], void>(CH.screenshot.CAPTURE),
  copyScreenshotToClipboard: createInvokeBridge<[Uint8Array], void>(CH.screenshot.COPY),
  onScreenshotCaptured: createSubscription<ScreenshotCaptureData>(CH.screenshot.CAPTURED),
};
