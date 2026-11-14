import { CH } from '../../channels';
import {
  createInvokeBridge,
  createSendBridge,
  createVoidSubscription,
} from '../../lib/ipc-renderer';
import type { RegisteredCaptureShortcuts } from '../../../src/types/index';

export const captureShortcutsBridge = {
  getCaptureShortcuts: createInvokeBridge<[], RegisteredCaptureShortcuts>(CH.captureShortcuts.GET),
  onVideoModeRequested: createVoidSubscription(CH.captureShortcuts.VIDEO_MODE_REQUESTED),
  setToolbarRecording: createSendBridge<[boolean]>(CH.captureShortcuts.TOOLBAR_RECORDING),
};
