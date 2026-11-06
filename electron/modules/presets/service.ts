import path from 'node:path';
import { app } from 'electron';
import { BRAND_KIT_PRESET_ID } from '../../../src/lib/presets/brand-kit';
import type { StylePreset, StylePresetAssets, StylePresetDraft } from '../../../src/types/index';
import { getBrandKitSync } from '../director/service';
import { createPresetAssets, PRESET_ASSETS_FOLDER } from './assets';
import { createPresetsStore, type PresetsStore } from './store';

let store: PresetsStore | null = null;

const getStore = (): PresetsStore => {
  if (!store) {
    const userData = app.getPath('userData');
    store = createPresetsStore({
      filePath: path.join(userData, 'presets.json'),
      assets: createPresetAssets(path.join(userData, PRESET_ASSETS_FOLDER)),
    });
  }
  return store;
};

/** The workspace brand kit (while signed in to Director) first, then this app's presets. */
export async function getPresets(): Promise<StylePreset[]> {
  const brandKit = getBrandKitSync().getPreset();
  const own = await getStore().list();
  return brandKit ? [brandKit, ...own] : own;
}

export function savePreset(draft: StylePresetDraft): Promise<StylePreset> {
  return getStore().create(draft);
}

/** The brand kit is read-only: it can't be deleted here, only in Director. */
export async function deletePreset(id: string): Promise<void> {
  if (id === BRAND_KIT_PRESET_ID) {
    return;
  }
  await getStore().remove(id);
}

const findPreset = async (id: string): Promise<StylePreset> => {
  const preset = (await getPresets()).find((p) => p.id === id);
  if (!preset) {
    throw new Error(`No preset ${id}`);
  }
  return preset;
};

export async function duplicatePreset(id: string, name: string): Promise<StylePreset> {
  return getStore().duplicate(await findPreset(id), name);
}

export async function getPresetAssets(id: string): Promise<StylePresetAssets> {
  return getStore().readAssets(await findPreset(id));
}

/** The presets menu opened: sync the brand kit if it's been a few minutes. */
export function refreshBrandKit(): Promise<void> {
  return getBrandKitSync().sync();
}
