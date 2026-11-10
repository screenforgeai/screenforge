import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BACKGROUND } from '../../../src/lib/effects/frame/analyze';
import {
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_CAPTION_APPEARANCE,
  DEFAULT_CURSOR_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
} from '../../../src/store/defaults';
import type { StylePreset, StylePresetDraft } from '../../../src/types/index';
import { createPresetAssets } from './assets';
import { createPresetsStore } from './store';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;
const JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString('base64')}`;

const DRAFT: StylePresetDraft = {
  name: '  Launch  ',
  background: { ...DEFAULT_BACKGROUND, wallpaperSeed: -1 },
  cursor: DEFAULT_CURSOR_SETTINGS,
  camera: DEFAULT_CAMERA_SETTINGS,
  keyboard: DEFAULT_KEYBOARD_SETTINGS,
  captionsAppearance: DEFAULT_CAPTION_APPEARANCE,
  logo: { dataUrl: PNG_DATA_URL, corner: 'top-left', size: 0.12, opacity: 80 },
  customWallpaperDataUrl: JPEG_DATA_URL,
  font: 'Georgia',
};

describe('presets store', () => {
  let dir: string;
  let file: string;
  let assetsDir: string;
  let ids: number;

  const setup = () =>
    createPresetsStore({
      filePath: file,
      assets: createPresetAssets(assetsDir),
      now: () => new Date('2026-11-06T10:00:00.000Z'),
      makeId: () => `preset_${++ids}`,
    });

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-presets-'));
    file = path.join(dir, 'presets.json');
    assetsDir = path.join(dir, 'preset-assets');
    ids = 0;
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it('starts empty, and survives a missing or broken file', async () => {
    expect(await setup().list()).toEqual([]);
    await fs.writeFile(file, '{not json');
    expect(await setup().list()).toEqual([]);
  });

  it('loads presets saved by earlier versions unchanged, and skips junk', async () => {
    const old: StylePreset = {
      id: 'preset_old',
      name: 'Dark Studio',
      savedAt: '2026-01-01T00:00:00.000Z',
      background: DEFAULT_BACKGROUND,
      cursor: DEFAULT_CURSOR_SETTINGS,
      camera: DEFAULT_CAMERA_SETTINGS,
      keyboard: DEFAULT_KEYBOARD_SETTINGS,
      captionsAppearance: DEFAULT_CAPTION_APPEARANCE,
    };
    await fs.writeFile(file, JSON.stringify([old, { id: 'junk' }]));
    expect(await setup().list()).toEqual([old]);
  });

  it('saves a preset with its logo and custom wallpaper copied into its folder', async () => {
    const store = setup();
    const saved = await store.create(DRAFT);
    expect(saved).toEqual({
      id: 'preset_1',
      name: 'Launch',
      savedAt: '2026-11-06T10:00:00.000Z',
      background: DRAFT.background,
      cursor: DRAFT.cursor,
      camera: DRAFT.camera,
      keyboard: DRAFT.keyboard,
      captionsAppearance: DRAFT.captionsAppearance,
      logo: {
        path: path.join(assetsDir, 'preset_1', 'logo.png'),
        corner: 'top-left',
        size: 0.12,
        opacity: 80,
      },
      customWallpaperPath: path.join(assetsDir, 'preset_1', 'wallpaper.jpg'),
      font: 'Georgia',
    });
    expect(await setup().list()).toEqual([saved]);
    expect(await store.readAssets(saved)).toEqual({
      logoDataUrl: PNG_DATA_URL,
      customWallpaperDataUrl: JPEG_DATA_URL,
    });
  });

  it('saves a preset without images or font', async () => {
    const saved = await setup().create({
      ...DRAFT,
      logo: null,
      customWallpaperDataUrl: null,
      font: null,
    });
    expect(saved.logo).toBeNull();
    expect(saved.customWallpaperPath).toBeUndefined();
    expect(saved.font).toBeUndefined();
    expect(await setup().readAssets(saved)).toEqual({
      logoDataUrl: null,
      customWallpaperDataUrl: null,
    });
  });

  it('drops an image that is not one, keeping the rest', async () => {
    const saved = await setup().create({
      ...DRAFT,
      logo: { corner: 'top-left', size: 0.1, opacity: 100, dataUrl: 'data:text/html;base64,PGI+' },
    });
    expect(saved.logo).toBeNull();
    expect(saved.customWallpaperPath).toBeDefined();
  });

  it('refuses a preset with no name, or claiming to be the workspace brand kit', async () => {
    await expect(setup().create({ ...DRAFT, name: '   ' })).rejects.toThrow();
    const saved = await setup().create({ ...DRAFT, source: 'director' } as never);
    expect(saved.source).toBeUndefined();
  });

  it('saves several presets at once without losing any', async () => {
    const store = setup();
    await Promise.all([
      store.create({ ...DRAFT, name: 'A' }),
      store.create({ ...DRAFT, name: 'B' }),
      store.create({ ...DRAFT, name: 'C' }),
    ]);
    expect((await store.list()).map((p) => p.name).sort()).toEqual(['A', 'B', 'C']);
  });

  it('deletes a preset along with its images', async () => {
    const store = setup();
    const saved = await store.create(DRAFT);
    await store.remove(saved.id);
    expect(await store.list()).toEqual([]);
    await expect(fs.stat(path.join(assetsDir, saved.id))).rejects.toThrow();
  });

  it('duplicates a read-only workspace preset as an editable one, images included', async () => {
    const store = setup();
    const assets = createPresetAssets(assetsDir);
    const logoPath = await assets.write('director-brand-kit', 'logo', PNG, 'image/png');
    const brandKit: StylePreset = {
      id: 'director-brand-kit',
      name: 'Acme',
      savedAt: '2026-11-01T00:00:00.000Z',
      source: 'director',
      background: DEFAULT_BACKGROUND,
      cursor: DEFAULT_CURSOR_SETTINGS,
      captionsAppearance: DEFAULT_CAPTION_APPEARANCE,
      logo: { path: logoPath, corner: 'bottom-right', size: 0.1, opacity: 100 },
      font: 'Inter',
    };
    const copy = await store.duplicate(brandKit, 'Acme copy');
    expect(copy).toEqual({
      ...brandKit,
      id: 'preset_1',
      name: 'Acme copy',
      savedAt: '2026-11-06T10:00:00.000Z',
      source: undefined,
      logo: { ...brandKit.logo, path: path.join(assetsDir, 'preset_1', 'logo.png') },
    });
    expect('source' in copy).toBe(false);
    expect(await store.list()).toEqual([copy]);
  });
});
