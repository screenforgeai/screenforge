import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { StylePreset } from '../../../src/types/index';

const presetsPath = () => path.join(app.getPath('userData'), 'presets.json');

export async function getPresets(): Promise<StylePreset[]> {
  try {
    const raw = await fs.readFile(presetsPath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as StylePreset[];
  } catch {
    return [];
  }
}

export async function savePreset(preset: StylePreset): Promise<StylePreset> {
  const all = await getPresets();
  const idx = all.findIndex((p) => p.id === preset.id);
  if (idx >= 0) {
    all[idx] = preset;
  } else {
    all.push(preset);
  }
  await fs.writeFile(presetsPath(), JSON.stringify(all), 'utf8');
  return preset;
}

export async function deletePreset(id: string): Promise<void> {
  const all = await getPresets();
  await fs.writeFile(presetsPath(), JSON.stringify(all.filter((p) => p.id !== id)), 'utf8');
}
