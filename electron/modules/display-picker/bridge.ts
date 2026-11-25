import { CH } from '../../channels';
import { createInvokeBridge, createSendBridge } from '../../lib/ipc-renderer';
import type { DisplayPickerPurpose, DisplayPickerTarget } from '../../../src/types/index';

export const displayPickerBridge = {
  /** Covers each monitor with an overlay to click the one to capture; null when cancelled. */
  pickDisplay: createInvokeBridge<[purpose: DisplayPickerPurpose], number | null>(
    CH.displayPicker.OPEN,
  ),
  /** Overlay: the monitor it covers. */
  getDisplayPickerTarget: createInvokeBridge<[], DisplayPickerTarget | null>(
    CH.displayPicker.GET_TARGET,
  ),
  /** Overlay: picks its monitor, or the one with that number. */
  confirmDisplayPick: createInvokeBridge<[number?: number], void>(CH.displayPicker.CONFIRM),
  cancelDisplayPick: createSendBridge<[]>(CH.displayPicker.CANCEL),
};
