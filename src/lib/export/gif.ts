import type { ExportFormat, ExportFps } from '../../types';

export const VIDEO_EXPORT_FPS_OPTIONS: readonly ExportFps[] = [24, 30, 60];
export const GIF_EXPORT_FPS_OPTIONS: readonly ExportFps[] = [20, 25];

export const DEFAULT_VIDEO_EXPORT_FPS: ExportFps = 60;
export const DEFAULT_GIF_EXPORT_FPS: ExportFps = 25;

type VideoExportFps = 24 | 30 | 60;
type GifExportFps = 20 | 25;

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function findNearestOption<T extends number>(value: number, options: readonly T[]): T {
  let best = options[0];
  let bestDistance = Math.abs(value - best);

  for (const option of options.slice(1)) {
    const distance = Math.abs(value - option);
    if (distance < bestDistance || (distance === bestDistance && option > best)) {
      best = option;
      bestDistance = distance;
    }
  }

  return best;
}

export function isVideoExportFps(value: number): value is VideoExportFps {
  return VIDEO_EXPORT_FPS_OPTIONS.includes(value as VideoExportFps);
}

export function isGifExportFps(value: number): value is GifExportFps {
  return GIF_EXPORT_FPS_OPTIONS.includes(value as GifExportFps);
}

export function getExportFpsOptions(format: ExportFormat): readonly ExportFps[] {
  return format === 'gif' ? GIF_EXPORT_FPS_OPTIONS : VIDEO_EXPORT_FPS_OPTIONS;
}

export function normalizeExportFpsForFormat(
  format: ExportFormat,
  fps: number | null | undefined,
): ExportFps {
  if (format === 'gif') {
    return findNearestOption(
      isFiniteNumber(fps) ? fps : DEFAULT_GIF_EXPORT_FPS,
      GIF_EXPORT_FPS_OPTIONS,
    );
  }

  return isVideoExportFps(fps ?? Number.NaN) ? fps : DEFAULT_VIDEO_EXPORT_FPS;
}
