import { CH } from '../../channels';
import { createSendBridge, createSubscription } from '../../lib/ipc-renderer';

export const teleprompterBridge = {
  toggleTeleprompter: createSendBridge<[]>(CH.teleprompter.TOGGLE),
  closeTeleprompter: createSendBridge<[]>(CH.teleprompter.CLOSE),
  onTeleprompterReady: createSubscription<void>(CH.teleprompter.READY),
  onTeleprompterClosed: createSubscription<void>(CH.teleprompter.CLOSED),
};
