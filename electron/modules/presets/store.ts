import fs from 'node:fs/promises';
import path from 'node:path';
import { BRAND_KIT_PRESET_ID } from '../../../src/lib/presets/brand-kit';
import { normalizeStylePreset } from '../../../src/lib/presets/style-preset';
import type { StylePreset, StylePresetAssets, StylePresetDraft } from '../../../src/types/index';
import {
  MAX_LOGO_BYTES,
  MAX_WALLPAPER_BYTES,
  parseImageDataUrl,
  type PresetAssets,
} from './assets';

const MAX_NAME_LENGTH = 80;

export interface PresetsStoreOptions {
  /** userData/presets.json: this app's presets (never the workspace brand kit). */
  filePath: string;
  assets: PresetAssets;
  now?: () => Date;
  makeId?: () => string;
}

const defaultId = () => `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/** The presets made in this app, with their images in the preset assets folder. */
export function createPresetsStore({
  filePath,
  assets,
  now = () => new Date(),
  makeId = defaultId,
}: PresetsStoreOptions) {
  // Saves read, change and write the whole file; one at a time, so none is lost.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const readAll = async (): Promise<StylePreset[]> => {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map(normalizeStylePreset)
        .filter(
          (preset): preset is StylePreset =>
            preset !== null && preset.source !== 'director' && preset.id !== BRAND_KIT_PRESET_ID,
        );
    } catch {
      return [];
    }
  };

  const writeAll = async (presets: StylePreset[]) => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(presets), 'utf8');
  };

  const cleanName = (name: unknown): string => {
    const trimmed = typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : '';
    if (!trimmed) {
      throw new Error('A preset needs a name.');
    }
    return trimmed;
  };

  const append = (preset: StylePreset) =>
    exclusive(async () => {
      await writeAll([...(await readAll()), preset]);
      return preset;
    });

  const build = (raw: Record<string, unknown>): StylePreset => {
    const preset = normalizeStylePreset(raw);
    if (!preset) {
      throw new Error('Not a style preset.');
    }
    return preset;
  };

  return {
    list: () => exclusive(readAll),

    async create(draft: StylePresetDraft): Promise<StylePreset> {
      const name = cleanName(draft.name);
      const id = makeId();
      try {
        const logoImage = draft.logo ? parseImageDataUrl(draft.logo.dataUrl, MAX_LOGO_BYTES) : null;
        const wallpaperImage = draft.customWallpaperDataUrl
          ? parseImageDataUrl(draft.customWallpaperDataUrl, MAX_WALLPAPER_BYTES)
          : null;
        const logoPath = logoImage
          ? await assets.write(id, 'logo', logoImage.bytes, logoImage.mime)
          : null;
        const wallpaperPath = wallpaperImage
          ? await assets.write(id, 'wallpaper', wallpaperImage.bytes, wallpaperImage.mime)
          : null;
        const preset = build({
          id,
          name,
          savedAt: now().toISOString(),
          background: draft.background,
          cursor: draft.cursor,
          ...(draft.camera ? { camera: draft.camera } : {}),
          ...(draft.keyboard ? { keyboard: draft.keyboard } : {}),
          captionsAppearance: draft.captionsAppearance,
          logo:
            logoPath && draft.logo
              ? {
                  path: logoPath,
                  corner: draft.logo.corner,
                  size: draft.logo.size,
                  opacity: draft.logo.opacity,
                }
              : null,
          customWallpaperPath: wallpaperPath ?? undefined,
          font: draft.font ?? undefined,
        });
        return await append(preset);
      } catch (err) {
        await assets.remove(id).catch(() => undefined);
        throw err;
      }
    },

    /** An editable copy (the brand kit's included), with its own copies of the images. */
    async duplicate(source: StylePreset, name: string): Promise<StylePreset> {
      const cleanedName = cleanName(name);
      const id = makeId();
      try {
        const { logo, customWallpaperPath } = source;
        const logoPath = logo ? await assets.copy(logo.path, id, 'logo') : null;
        const wallpaperPath = customWallpaperPath
          ? await assets.copy(customWallpaperPath, id, 'wallpaper')
          : null;
        // normalizeStylePreset drops the undefined fields: the copy isn't the brand kit.
        const preset = build({
          ...source,
          source: undefined,
          id,
          name: cleanedName,
          savedAt: now().toISOString(),
          logo:
            logo === undefined ? undefined : logo && logoPath ? { ...logo, path: logoPath } : null,
          customWallpaperPath: wallpaperPath ?? undefined,
        });
        return await append(preset);
      } catch (err) {
        await assets.remove(id).catch(() => undefined);
        throw err;
      }
    },

    remove: (id: string) =>
      exclusive(async () => {
        const all = await readAll();
        if (!all.some((preset) => preset.id === id)) {
          return;
        }
        await writeAll(all.filter((preset) => preset.id !== id));
        await assets.remove(id).catch(() => undefined);
      }),

    async readAssets(preset: StylePreset): Promise<StylePresetAssets> {
      return {
        logoDataUrl: preset.logo ? await assets.read(preset.logo.path) : null,
        customWallpaperDataUrl: preset.customWallpaperPath
          ? await assets.read(preset.customWallpaperPath)
          : null,
      };
    },
  };
}

export type PresetsStore = ReturnType<typeof createPresetsStore>;
