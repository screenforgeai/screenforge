import { CH } from '../../channels';
import { createInvokeBridge, createSubscription } from '../../lib/ipc-renderer';
import type { UpdaterState } from '../../../src/types/index';

export const updaterBridge = {
  onUpdaterStateChanged: createSubscription<UpdaterState>(CH.updater.STATE_CHANGED),
  getUpdaterState: createInvokeBridge<[], UpdaterState>(CH.updater.GET_STATE),
  checkForUpdatesNow: createInvokeBridge<[], UpdaterState>(CH.updater.CHECK_NOW),
  restartToApplyUpdate: createInvokeBridge<[], void>(CH.updater.RESTART_TO_APPLY_UPDATE),
};
