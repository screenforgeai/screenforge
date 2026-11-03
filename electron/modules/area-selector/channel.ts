import { CH } from '../../channels';
import { handleChannel, listenChannel } from '../../lib/ipc-main';
import { BrowserWindow } from 'electron';
import { confirmAreaSelection, cancelAreaSelection, openAreaSelector } from './service';

export function registerAreaSelectorChannels(
  preloadPath: string,
  loadURL: (win: BrowserWindow, hash: string) => void,
): void {
  handleChannel<[{ x: number; y: number; width: number; height: number }], void>(
    CH.areaSelector.CONFIRM,
    (area) => {
      confirmAreaSelection(area);
    },
  );

  listenChannel(CH.areaSelector.CANCEL, () => {
    cancelAreaSelection();
  });

  handleChannel(CH.areaSelector.OPEN, () => openAreaSelector(preloadPath, loadURL));
}
