import w2 from '../../../assets/wallpapers/wallpaper-02.webp';
import w3 from '../../../assets/wallpapers/wallpaper-03.webp';
import w4 from '../../../assets/wallpapers/wallpaper-04.webp';
import w5 from '../../../assets/wallpapers/wallpaper-05.webp';
import w6 from '../../../assets/wallpapers/wallpaper-06.webp';
import w7 from '../../../assets/wallpapers/wallpaper-07.webp';
import w8 from '../../../assets/wallpapers/wallpaper-08.webp';
import w9 from '../../../assets/wallpapers/wallpaper-09.webp';
import w10 from '../../../assets/wallpapers/wallpaper-10.webp';
import w11 from '../../../assets/wallpapers/wallpaper-11.webp';
import w12 from '../../../assets/wallpapers/wallpaper-12.webp';
import w13 from '../../../assets/wallpapers/wallpaper-13.webp';
import w14 from '../../../assets/wallpapers/wallpaper-14.webp';

export interface WallpaperPreset {
  id: string;
  label: string;
  url: string;
}

/** Sentinel wallpaperSeed value meaning "use the user-picked custom image". */
export const CUSTOM_WALLPAPER_SEED = -1;

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { id: 'night', label: 'Night', url: w2 },
  { id: 'color-days', label: 'Color Days', url: w3 },
  { id: 'dark', label: 'Dark', url: w4 },
  { id: 'ventura', label: 'Ventura', url: w5 },
  { id: 'sequoia', label: 'Sequoia', url: w6 },
  { id: 'custom-01', label: 'Custom', url: w7 },
  { id: 'custom-02', label: 'Custom', url: w8 },
  { id: 'custom-03', label: 'Custom', url: w9 },
  { id: 'custom-04', label: 'Custom', url: w10 },
  { id: 'custom-05', label: 'Custom', url: w11 },
  { id: 'shadeshifter', label: 'Shadeshifter', url: w12 },
  { id: 'ember', label: 'Ember', url: w13 },
  { id: 'sparkle', label: 'Sparkle', url: w14 },
];

// ── Custom user wallpaper (session-only, not persisted) ──────────────────────

/** Data URL of the user-picked custom wallpaper. Cleared on app restart. */
let customWallpaperUrl: string | null = null;

export function setCustomWallpaperUrl(url: string | null): void {
  customWallpaperUrl = url;
  if (url) {
    getWallpaperImage(url);
  }
}

export function getCustomWallpaperUrl(): string | null {
  return customWallpaperUrl;
}

/**
 * Resolves a wallpaperSeed to a preset. Handles CUSTOM_WALLPAPER_SEED (-1)
 * by returning a synthetic preset for the user-picked image.
 */
export function resolveWallpaperPreset(seed: number): WallpaperPreset {
  if (seed === CUSTOM_WALLPAPER_SEED && customWallpaperUrl) {
    return { id: 'custom-user', label: 'Custom', url: customWallpaperUrl };
  }
  return WALLPAPER_PRESETS[seed % WALLPAPER_PRESETS.length] ?? WALLPAPER_PRESETS[0];
}

/** Ensures the custom wallpaper image is fully loaded (for export pipeline). */
export function preloadCustomWallpaperAsync(): Promise<void> {
  if (!customWallpaperUrl) {
    return Promise.resolve();
  }
  const img = getWallpaperImage(customWallpaperUrl);
  if (img.complete && img.naturalWidth > 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const onDone = () => {
      img.removeEventListener('load', onDone);
      img.removeEventListener('error', onDone);
      resolve();
    };
    img.addEventListener('load', onDone);
    img.addEventListener('error', onDone);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

const cache = new Map<string, HTMLImageElement>();

/** Worker-context ImageBitmap cache. Populated by captureTimeline before export. */
const bitmapCache = new Map<string, ImageBitmap>();

export function setWallpaperBitmaps(bitmaps: Map<string, ImageBitmap>): void {
  bitmapCache.clear();
  for (const [url, bitmap] of bitmaps) {
    bitmapCache.set(url, bitmap);
  }
}

export function getWallpaperBitmap(url: string): ImageBitmap | null {
  return bitmapCache.get(url) ?? null;
}

export function getWallpaperImage(url: string): HTMLImageElement {
  if (!cache.has(url)) {
    const img = new Image();
    img.src = url;
    cache.set(url, img);
  }
  const image = cache.get(url);
  if (!image) {
    throw new Error(`Wallpaper cache miss for ${url}`);
  }
  return image;
}

export function preloadWallpapers(): void {
  for (const preset of WALLPAPER_PRESETS) {
    getWallpaperImage(preset.url);
  }
}

/** Ensures all wallpaper HTMLImageElements have finished loading. */
export function preloadWallpapersAsync(): Promise<void> {
  const waits = WALLPAPER_PRESETS.map((preset) => {
    const img = getWallpaperImage(preset.url);
    if (img.complete && img.naturalWidth > 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const onDone = () => {
        img.removeEventListener('load', onDone);
        img.removeEventListener('error', onDone);
        resolve();
      };
      img.addEventListener('load', onDone);
      img.addEventListener('error', onDone);
    });
  });
  return Promise.all(waits).then(() => undefined);
}
