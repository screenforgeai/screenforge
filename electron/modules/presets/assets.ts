import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Images that belong to style presets (a logo, a custom wallpaper), kept in
 * userData/preset-assets/<preset id>/. Renderers never send or get a path to
 * read: images go in and come out as data URLs, and reads are confined to
 * this folder.
 */

/** The folder under userData. */
export const PRESET_ASSETS_FOLDER = 'preset-assets';

export type PresetAssetKind = 'logo' | 'wallpaper';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_WALLPAPER_BYTES = 25 * 1024 * 1024;

export const isPresetImageMime = (mime: string): boolean =>
  Object.prototype.hasOwnProperty.call(EXTENSION_BY_MIME, mime);

/** A base64 image data URL's bytes, or null for anything else or anything too big. */
export function parseImageDataUrl(
  dataUrl: string,
  maxBytes: number,
): { mime: string; bytes: Buffer } | null {
  const match = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) {
    return null;
  }
  const mime = match[1].toLowerCase();
  if (!isPresetImageMime(mime)) {
    return null;
  }
  // Check the encoded length first, so a huge string is never decoded.
  if (Math.floor((match[2].length * 3) / 4) > maxBytes + 3) {
    return null;
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > maxBytes) {
    return null;
  }
  return { mime, bytes };
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export function createPresetAssets(rootDir: string) {
  const root = path.resolve(rootDir);

  const dirFor = (presetId: string): string => {
    if (!SAFE_ID.test(presetId)) {
      throw new Error(`Invalid preset id: ${presetId}`);
    }
    return path.join(root, presetId);
  };

  /** The file, if it is an image inside the assets folder. */
  const insideRoot = (filePath: string): string | null => {
    const resolved = path.resolve(filePath);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    return resolved;
  };

  const mimeOf = (filePath: string): string | null =>
    MIME_BY_EXTENSION[path.extname(filePath).slice(1).toLowerCase()] ?? null;

  const removeKind = async (dir: string, kind: PresetAssetKind) => {
    const entries = await fs.readdir(dir).catch(() => [] as string[]);
    await Promise.all(
      entries
        .filter((name) => path.parse(name).name === kind)
        .map((name) => fs.rm(path.join(dir, name), { force: true })),
    );
  };

  return {
    root,

    /** Writes `<kind>.<ext>` for the preset, replacing an earlier one. Returns its path. */
    async write(
      presetId: string,
      kind: PresetAssetKind,
      bytes: Uint8Array,
      mime: string,
    ): Promise<string> {
      const extension = EXTENSION_BY_MIME[mime];
      if (!extension) {
        throw new Error(`Unsupported image type: ${mime}`);
      }
      const dir = dirFor(presetId);
      await fs.mkdir(dir, { recursive: true });
      await removeKind(dir, kind);
      const filePath = path.join(dir, `${kind}.${extension}`);
      await fs.writeFile(filePath, bytes);
      return filePath;
    },

    /** The image as a data URL; null if it is missing or outside the assets folder. */
    async read(filePath: string): Promise<string | null> {
      const resolved = insideRoot(filePath);
      const mime = resolved ? mimeOf(resolved) : null;
      if (!resolved || !mime) {
        return null;
      }
      try {
        const bytes = await fs.readFile(resolved);
        return `data:${mime};base64,${bytes.toString('base64')}`;
      } catch {
        return null;
      }
    },

    /** Copies an image from the assets folder to another preset; null if it can't. */
    async copy(
      filePath: string,
      toPresetId: string,
      kind: PresetAssetKind,
    ): Promise<string | null> {
      const resolved = insideRoot(filePath);
      const mime = resolved ? mimeOf(resolved) : null;
      if (!resolved || !mime) {
        return null;
      }
      try {
        const bytes = await fs.readFile(resolved);
        return await this.write(toPresetId, kind, bytes, mime);
      } catch {
        return null;
      }
    },

    async removeKind(presetId: string, kind: PresetAssetKind): Promise<void> {
      await removeKind(dirFor(presetId), kind);
    },

    async remove(presetId: string): Promise<void> {
      await fs.rm(dirFor(presetId), { recursive: true, force: true });
    },
  };
}

export type PresetAssets = ReturnType<typeof createPresetAssets>;
