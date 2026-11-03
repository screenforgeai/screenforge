import type { BrowserWindow } from 'electron';
import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import {
  checkForUpdatesNow,
  getUpdaterState,
  onUpdaterStateChanged,
  restartToApplyUpdate,
} from './service';

type RegisterUpdaterChannelsOptions = {
  getMainWindow: () => BrowserWindow | null;
};

let unsubscribeStateForwarder: (() => void) | null = null;

export function registerUpdaterChannels({ getMainWindow }: RegisterUpdaterChannelsOptions): void {
  handleChannel(CH.updater.GET_STATE, () => getUpdaterState());
  handleChannel(CH.updater.CHECK_NOW, () => checkForUpdatesNow());
  handleChannel(CH.updater.RESTART_TO_APPLY_UPDATE, () => restartToApplyUpdate());

  if (!unsubscribeStateForwarder) {
    unsubscribeStateForwarder = onUpdaterStateChanged((state) => {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      mainWindow.webContents.send(CH.updater.STATE_CHANGED, state);
    });
  }
}
