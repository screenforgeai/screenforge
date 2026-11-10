import { CH } from '../../channels';
import { createInvokeBridge, createSendBridge } from '../../lib/ipc-renderer';
import type { SelectedArea } from '../../../src/types/index';

export const areaSelectorBridge = {
  confirmAreaSelection: createInvokeBridge<
    [{ x: number; y: number; width: number; height: number }],
    void
  >(CH.areaSelector.CONFIRM),
  cancelAreaSelection: createSendBridge<[]>(CH.areaSelector.CANCEL),
  openAreaSelector: createInvokeBridge<[purpose?: 'record' | 'screenshot'], SelectedArea | null>(
    CH.areaSelector.OPEN,
  ),
};
