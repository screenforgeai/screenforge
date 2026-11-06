import { CH } from '../../channels';
import { createInvokeBridge, createVoidSubscription } from '../../lib/ipc-renderer';
import type { StylePreset, StylePresetAssets, StylePresetDraft } from '../../../src/types/index';

export const presetsBridge = {
  getPresets: createInvokeBridge<[], StylePreset[]>(CH.presets.GET_ALL),
  savePreset: createInvokeBridge<[StylePresetDraft], StylePreset>(CH.presets.SAVE),
  deletePreset: createInvokeBridge<[string], void>(CH.presets.DELETE),
  duplicatePreset: createInvokeBridge<[string, string], StylePreset>(CH.presets.DUPLICATE),
  getPresetAssets: createInvokeBridge<[string], StylePresetAssets>(CH.presets.GET_ASSETS),
  refreshBrandKit: createInvokeBridge<[], void>(CH.presets.REFRESH_BRAND_KIT),
  onPresetsChanged: createVoidSubscription(CH.presets.CHANGED),
};
