import type { BrowserWindow } from 'electron';
import { CH } from '../../channels';
import { handleChannel, handleChannelWithSender, listenChannel } from '../../lib/ipc-main';
import {
  cancelDisplayPick,
  confirmDisplayPick,
  getDisplayPickerTarget,
  openDisplayPicker,
} from './service';
import type { DisplayPickerTarget } from '../../../src/types/index';

export function registerDisplayPickerChannels(
  preloadPath: string,
  loadURL: (win: BrowserWindow, hash: string) => void,
): void {
  handleChannel<[unknown], number | null>(CH.displayPicker.OPEN, (purpose) =>
    openDisplayPicker(
      preloadPath,
      loadURL,
      purpose === 'screenshot' || purpose === 'area' ? purpose : 'record',
    ),
  );

  handleChannelWithSender<[], DisplayPickerTarget | null>(CH.displayPicker.GET_TARGET, (sender) =>
    getDisplayPickerTarget(sender.id),
  );

  handleChannelWithSender<[unknown], void>(CH.displayPicker.CONFIRM, (sender, number) => {
    const picked = typeof number === 'number' && Number.isInteger(number) ? number : undefined;
    confirmDisplayPick(sender.id, picked);
  });

  listenChannel(CH.displayPicker.CANCEL, () => {
    cancelDisplayPick();
  });
}
