import { describe, expect, it, vi } from 'vitest';
import {
  getCustomWallpaperUrl,
  setCustomWallpaperUrl,
  subscribeCustomWallpaper,
} from './wallpapers';

describe('custom wallpaper', () => {
  it('tells subscribers when a preset sets a new custom wallpaper', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCustomWallpaper(listener);
    setCustomWallpaperUrl('data:image/png;base64,AA==');
    expect(getCustomWallpaperUrl()).toBe('data:image/png;base64,AA==');
    setCustomWallpaperUrl('data:image/png;base64,AA==');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setCustomWallpaperUrl(null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
