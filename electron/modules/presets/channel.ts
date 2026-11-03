import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getPresets, savePreset, deletePreset } from './service';
import type { StylePreset } from '../../../src/types/index';

export function registerPresetsChannels(): void {
  handleChannel(CH.presets.GET_ALL, () => getPresets());
  handleChannel<[StylePreset], StylePreset>(CH.presets.SAVE, (preset) => savePreset(preset));
  handleChannel<[string], void>(CH.presets.DELETE, (id) => deletePreset(id));
}
