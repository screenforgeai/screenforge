import { CH } from '../../channels';
import { createInvokeBridge, createSendBridge } from '../../lib/ipc-renderer';

export const areaSelectorBridge = {
  confirmAreaSelection: createInvokeBridge<
    [{ x: number; y: number; width: number; height: number }],
    void
  >(CH.areaSelector.CONFIRM),
  cancelAreaSelection: createSendBridge<[]>(CH.areaSelector.CANCEL),
  openAreaSelector: createInvokeBridge<
    [],
    { x: number; y: number; width: number; height: number } | null
  >(CH.areaSelector.OPEN),
};
