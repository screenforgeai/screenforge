import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPresetAssets, parseImageDataUrl } from './assets';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

describe('parseImageDataUrl', () => {
  it('reads a base64 image data URL', () => {
    expect(parseImageDataUrl(PNG_DATA_URL, 1024)).toEqual({ mime: 'image/png', bytes: PNG });
  });

  it('refuses other types, non-base64, empty and oversized images', () => {
    expect(parseImageDataUrl('data:text/html;base64,PGI+', 1024)).toBeNull();
    expect(parseImageDataUrl('data:image/png,abc', 1024)).toBeNull();
    expect(parseImageDataUrl('data:image/png;base64,', 1024)).toBeNull();
    expect(parseImageDataUrl(PNG_DATA_URL, 4)).toBeNull();
    expect(parseImageDataUrl('https://example.com/a.png', 1024)).toBeNull();
  });
});

describe('preset assets', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-preset-assets-'));
  });
  afterEach(() => fs.rm(root, { recursive: true, force: true }));

  it('writes an image into the preset folder and reads it back as a data URL', async () => {
    const assets = createPresetAssets(root);
    const file = await assets.write('preset_1', 'logo', PNG, 'image/png');
    expect(file).toBe(path.join(root, 'preset_1', 'logo.png'));
    expect(await fs.readFile(file)).toEqual(PNG);
    expect(await assets.read(file)).toBe(PNG_DATA_URL);
  });

  it('replaces an earlier image of the same kind, whatever its type', async () => {
    const assets = createPresetAssets(root);
    await assets.write('preset_1', 'logo', PNG, 'image/png');
    await assets.write('preset_1', 'logo', Buffer.from('<svg/>'), 'image/svg+xml');
    expect(await fs.readdir(path.join(root, 'preset_1'))).toEqual(['logo.svg']);
  });

  it('only reads image files inside the assets folder', async () => {
    const assets = createPresetAssets(root);
    const outside = path.join(os.tmpdir(), `sf-outside-${Date.now()}.png`);
    await fs.writeFile(outside, PNG);
    try {
      expect(await assets.read(outside)).toBeNull();
      expect(await assets.read(path.join(root, '..', path.basename(outside)))).toBeNull();
      expect(await assets.read(path.join(root, 'preset_1', 'missing.png'))).toBeNull();
      await fs.mkdir(path.join(root, 'p'), { recursive: true });
      await fs.writeFile(path.join(root, 'p', 'notes.txt'), 'hi');
      expect(await assets.read(path.join(root, 'p', 'notes.txt'))).toBeNull();
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it('refuses preset ids that would leave the folder', async () => {
    const assets = createPresetAssets(root);
    await expect(assets.write('../evil', 'logo', PNG, 'image/png')).rejects.toThrow();
    await expect(assets.remove('..')).rejects.toThrow();
  });

  it('copies an image to another preset, and removes a preset folder', async () => {
    const assets = createPresetAssets(root);
    const file = await assets.write('preset_1', 'wallpaper', PNG, 'image/png');
    const copy = await assets.copy(file, 'preset_2', 'wallpaper');
    expect(copy).toBe(path.join(root, 'preset_2', 'wallpaper.png'));
    await assets.remove('preset_1');
    await expect(fs.stat(path.join(root, 'preset_1'))).rejects.toThrow();
    expect(await assets.read(copy as string)).toBe(PNG_DATA_URL);
    expect(await assets.copy(path.join(root, 'nope.png'), 'preset_3', 'logo')).toBeNull();
  });
});
