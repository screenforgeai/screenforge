import { CH } from '../../channels';
import { createInvokeBridge } from '../../lib/ipc-renderer';
import type { WhatsNewLaunchState } from './service';

export const whatsNewBridge = {
  consumeWhatsNewOnLaunch: createInvokeBridge<[], WhatsNewLaunchState>(
    CH.whatsNew.CONSUME_ON_LAUNCH,
  ),
};
