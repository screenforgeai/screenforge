import { CH } from '../../channels';
import { handleChannel, listenChannel } from '../../lib/ipc-main';
import { BrowserWindow } from 'electron';
import {
  confirmAreaSelection,
  cancelAreaSelection,
  getAreaSelectorStill,
  openAreaSelector,
} from './service';
import type { AreaSelectorStill, SelectedArea } from '../../../src/types/index';

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

  handleChannel<[], AreaSelectorStill | null>(CH.areaSelector.GET_STILL, () =>
    getAreaSelectorStill(),
  );

  handleChannel<[unknown], SelectedArea | null>(CH.areaSelector.OPEN, (purpose) =>
    openAreaSelector(preloadPath, loadURL, purpose === 'screenshot' ? 'screenshot' : 'record'),
  );
}
