import type { ResolvedWindowBarTheme, WindowBarTheme } from './types';

/** How many rows at the top of the first frame decide an 'auto' theme. */
export const AUTO_THEME_SAMPLE_ROWS = 24;

/**
 * Average brightness (0–1, Rec. 709 luma) of the top `rows` of an RGBA
 * image, such as a canvas's ImageData or a decoded frame.
 */
export function topBandBrightness(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  rows: number = AUTO_THEME_SAMPLE_ROWS,
): number | null {
  const band = Math.min(height, Math.max(0, Math.round(rows)));
  if (width <= 0 || band <= 0) return null;
  let total = 0;
  const count = width * band;
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    total += 0.2126 * (rgba[p] ?? 0) + 0.7152 * (rgba[p + 1] ?? 0) + 0.0722 * (rgba[p + 2] ?? 0);
  }
  return total / count / 255;
}

/**
 * Light or dark. 'auto' follows the page: a bright top band (over 50%)
 * gets the light bar. Decided once per video, so the bar never flips
 * mid-demo; with nothing to sample, light.
 */
export function resolveWindowBarTheme(
  theme: WindowBarTheme,
  brightness: number | null | undefined,
): ResolvedWindowBarTheme {
  if (theme === 'light' || theme === 'dark') return theme;
  if (brightness === null || brightness === undefined || !Number.isFinite(brightness))
    return 'light';
  return brightness > 0.5 ? 'light' : 'dark';
}
