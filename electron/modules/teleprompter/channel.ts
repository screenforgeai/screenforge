import type { BrowserWindow } from 'electron';
import { CH } from '../../channels';
import { listenChannel } from '../../lib/ipc-main';
import { toggleTeleprompter, closeTeleprompter } from './service';

type Options = {
  preloadPath: string;
  loadURL: (win: BrowserWindow, hash: string) => void;
  getToolbarWindow: () => BrowserWindow | null;
};

export function registerTeleprompterChannels({
  preloadPath,
  loadURL,
  getToolbarWindow,
}: Options): void {
  const send = (channel: string) => getToolbarWindow()?.webContents.send(channel);

  listenChannel(CH.teleprompter.TOGGLE, () =>
    toggleTeleprompter(preloadPath, loadURL, {
      onReady: () => send(CH.teleprompter.READY),
      onClosed: () => send(CH.teleprompter.CLOSED),
    }),
  );

  listenChannel(CH.teleprompter.CLOSE, () => {
    closeTeleprompter();
    send(CH.teleprompter.CLOSED);
  });
}
