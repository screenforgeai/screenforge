import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import {
  getPresets,
  savePreset,
  deletePreset,
  duplicatePreset,
  getPresetAssets,
  refreshBrandKit,
} from './service';
import type { StylePreset, StylePresetAssets, StylePresetDraft } from '../../../src/types/index';

export function registerPresetsChannels(): void {
  handleChannel(CH.presets.GET_ALL, () => getPresets());
  handleChannel<[StylePresetDraft], StylePreset>(CH.presets.SAVE, (draft) => savePreset(draft));
  handleChannel<[string], void>(CH.presets.DELETE, (id) => deletePreset(id));
  handleChannel<[string, string], StylePreset>(CH.presets.DUPLICATE, (id, name) =>
    duplicatePreset(id, name),
  );
  handleChannel<[string], StylePresetAssets>(CH.presets.GET_ASSETS, (id) => getPresetAssets(id));
  handleChannel(CH.presets.REFRESH_BRAND_KIT, () => refreshBrandKit());
}
