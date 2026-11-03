export const FALLBACK_CAPTURE_BITS_PER_PIXEL_FRAME = 0.35;
export const FALLBACK_CAPTURE_MIN_BITRATE = 50_000_000;
export const FALLBACK_CAPTURE_MAX_BITRATE = 300_000_000;

type CaptureDisplayLike = {
  bounds: {
    width: number;
    height: number;
  };
  scaleFactor?: number;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeFallbackCaptureBitrateForPixels(
  pixelWidth: number,
  pixelHeight: number,
  fps: number,
): number {
  return Math.round(
    clampNumber(
      Math.max(1, pixelWidth) *
        Math.max(1, pixelHeight) *
        Math.max(1, fps) *
        FALLBACK_CAPTURE_BITS_PER_PIXEL_FRAME,
      FALLBACK_CAPTURE_MIN_BITRATE,
      FALLBACK_CAPTURE_MAX_BITRATE,
    ),
  );
}

export function computeFallbackCaptureBitrate(display: CaptureDisplayLike, fps: number): number {
  const scaleFactor = Math.max(1, display.scaleFactor || 1);
  const pixelWidth = Math.max(1, Math.round(display.bounds.width * scaleFactor));
  const pixelHeight = Math.max(1, Math.round(display.bounds.height * scaleFactor));
  return computeFallbackCaptureBitrateForPixels(pixelWidth, pixelHeight, fps);
}

export function formatFFmpegBitrate(bitRate: number): string {
  return `${Math.round(bitRate / 1_000_000)}M`;
}
