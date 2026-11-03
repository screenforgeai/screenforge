import { CH } from '../../channels';
import { createInvokeBridge } from '../../lib/ipc-renderer';
import type { StylePreset } from '../../../src/types/index';

export const presetsBridge = {
  getPresets: createInvokeBridge<[], StylePreset[]>(CH.presets.GET_ALL),
  savePreset: createInvokeBridge<[StylePreset], StylePreset>(CH.presets.SAVE),
  deletePreset: createInvokeBridge<[string], void>(CH.presets.DELETE),
};
