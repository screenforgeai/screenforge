import type { ExportFormat, ExportQuality, ExportResolution } from '../../types';

const DISPLAY_VIDEO_BITRATE_BASE_MAP: Record<ExportQuality, Record<ExportResolution, number>> = {
  fast: { '720p': 1_800_000, '1080p': 3_200_000, '4k': 8_000_000 },
  balanced: { '720p': 3_000_000, '1080p': 6_000_000, '4k': 14_000_000 },
  high: { '720p': 4_500_000, '1080p': 9_000_000, '4k': 20_000_000 },
};

// GIF size estimation: empirical bytes-per-frame for palette-based screen GIFs.
// This stays intentionally simple and errs a bit high because GIF size varies a lot
// with motion and palette complexity.
const GIF_BYTES_PER_PIXEL_PER_FRAME = 0.05;
const GIF_APPROX_PIXEL_COUNT: Record<ExportResolution, number> = {
  '720p': 1280 * 720,
  '1080p': 1920 * 1080,
  '4k': 1920 * 1080,
};

export function estimateDisplayVideoSizeBytes(options: {
  quality: ExportQuality;
  resolution: ExportResolution;
  fps: number;
  audioBitrateKbps: number;
  durationSeconds: number;
}): number {
  const durationSeconds = Math.max(0, options.durationSeconds);
  const fpsScale = Math.max(options.fps, 1) / 30;
  const videoBitrate =
    DISPLAY_VIDEO_BITRATE_BASE_MAP[options.quality][options.resolution] * fpsScale;
  const audioBitrate = Math.max(0, options.audioBitrateKbps) * 1000;
  return ((videoBitrate + audioBitrate) / 8) * durationSeconds;
}

export function estimateDisplayGifSizeBytes(options: {
  resolution: ExportResolution;
  fps: number;
  durationSeconds: number;
}): number {
  return (
    GIF_APPROX_PIXEL_COUNT[options.resolution] *
    GIF_BYTES_PER_PIXEL_PER_FRAME *
    Math.max(options.fps, 1) *
    Math.max(0, options.durationSeconds)
  );
}

export function estimateDisplayExportSizeBytes(options: {
  format: ExportFormat;
  quality: ExportQuality;
  resolution: ExportResolution;
  fps: number;
  audioBitrateKbps: number;
  durationSeconds: number;
}): number {
  if (options.format === 'gif') {
    return estimateDisplayGifSizeBytes({
      resolution: options.resolution,
      fps: options.fps,
      durationSeconds: options.durationSeconds,
    });
  }

  return estimateDisplayVideoSizeBytes({
    quality: options.quality,
    resolution: options.resolution,
    fps: options.fps,
    audioBitrateKbps: options.audioBitrateKbps,
    durationSeconds: options.durationSeconds,
  });
}
