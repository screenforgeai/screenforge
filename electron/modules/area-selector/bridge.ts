import { CH } from '../../channels';
import { createInvokeBridge, createSendBridge } from '../../lib/ipc-renderer';
import type {
  AreaSelectorStill,
  AreaSelectorStillRequest,
  SelectedArea,
} from '../../../src/types/index';

export const areaSelectorBridge = {
  confirmAreaSelection: createInvokeBridge<
    [{ x: number; y: number; width: number; height: number }],
    void
  >(CH.areaSelector.CONFIRM),
  cancelAreaSelection: createSendBridge<[]>(CH.areaSelector.CANCEL),
  getAreaSelectorStill: createInvokeBridge<[], AreaSelectorStill | null>(CH.areaSelector.GET_STILL),
  /** On the display with that id (picked on its overlay), else the main display. */
  openAreaSelector: createInvokeBridge<
    [purpose?: 'record' | 'screenshot', displayId?: number | null],
    SelectedArea | null
  >(CH.areaSelector.OPEN),
  selectAreaOnStill: createInvokeBridge<[still: AreaSelectorStillRequest], SelectedArea | null>(
    CH.areaSelector.OPEN_ON_STILL,
  ),
};
