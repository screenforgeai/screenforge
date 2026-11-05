import type { BackgroundSettings } from './index';
import { GRADIENT_PRESETS } from './presets';
import { resolveWallpaperPreset } from './wallpapers';

/** Neutral mid-grey that separates both light and dark recordings. */
export const NEUTRAL_PREVIEW_BACKGROUND = 'linear-gradient(160deg, #5a5a62 0%, #3e3e46 100%)';

/**
 * The project's frame background as a CSS `background`, for small previews that
 * should look like the real canvas. 'blur' returns null: the caller blurs the
 * recording itself behind the screen.
 */
export function frameBackgroundCss(background: BackgroundSettings): string | null {
  switch (background.type) {
    case 'wallpaper':
      return `center / cover no-repeat url("${resolveWallpaperPreset(background.wallpaperSeed).url}")`;
    case 'gradient': {
      const preset = GRADIENT_PRESETS.find((p) => p.id === background.gradientPresetId);
      if (!preset) {
        return NEUTRAL_PREVIEW_BACKGROUND;
      }
      const stops = preset.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ');
      return `linear-gradient(${preset.angle}deg, ${stops})`;
    }
    case 'solid':
      return background.solidColor || NEUTRAL_PREVIEW_BACKGROUND;
    case 'blur':
      return null;
    default:
      return NEUTRAL_PREVIEW_BACKGROUND;
  }
}
