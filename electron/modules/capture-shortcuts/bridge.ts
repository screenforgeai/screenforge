import { CH } from '../../channels';
import { createInvokeBridge, createVoidSubscription } from '../../lib/ipc-renderer';
import type { RegisteredCaptureShortcuts } from '../../../src/types/index';

export const captureShortcutsBridge = {
  getCaptureShortcuts: createInvokeBridge<[], RegisteredCaptureShortcuts>(CH.captureShortcuts.GET),
  onVideoModeRequested: createVoidSubscription(CH.captureShortcuts.VIDEO_MODE_REQUESTED),
};
