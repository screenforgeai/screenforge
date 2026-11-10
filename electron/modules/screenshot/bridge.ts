import { CH } from '../../channels';
import { createInvokeBridge, createSubscription } from '../../lib/ipc-renderer';
import type { ScreenshotCapture, ScreenshotCaptureRequest } from '../../../src/types/index';

export const screenshotBridge = {
  captureScreenshot: createInvokeBridge<[ScreenshotCaptureRequest], void>(CH.screenshot.CAPTURE),
  copyScreenshotToClipboard: createInvokeBridge<[string], void>(CH.screenshot.COPY),
  onScreenshotCaptured: createSubscription<ScreenshotCapture>(CH.screenshot.CAPTURED),
};
