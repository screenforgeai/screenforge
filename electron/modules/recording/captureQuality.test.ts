import { describe, expect, it } from 'vitest';
import {
  FALLBACK_CAPTURE_MAX_BITRATE,
  FALLBACK_CAPTURE_MIN_BITRATE,
  computeFallbackCaptureBitrate,
  computeFallbackCaptureBitrateForPixels,
  formatFFmpegBitrate,
} from './captureQuality';

describe('capture quality helpers', () => {
  it('uses backing pixels when estimating fallback capture bitrate', () => {
    expect(
      computeFallbackCaptureBitrate(
        {
          bounds: { width: 1440, height: 900 },
          scaleFactor: 2,
        },
        60,
      ),
    ).toBe(108_864_000);
  });

  it('keeps small captures above the minimum bitrate floor', () => {
    expect(computeFallbackCaptureBitrateForPixels(1280, 720, 30)).toBe(
      FALLBACK_CAPTURE_MIN_BITRATE,
    );
  });

  it('caps very large captures to avoid runaway file sizes', () => {
    expect(computeFallbackCaptureBitrateForPixels(7680, 4320, 60)).toBe(
      FALLBACK_CAPTURE_MAX_BITRATE,
    );
  });

  it('formats FFmpeg bitrate values in megabits', () => {
    expect(formatFFmpegBitrate(68_428_800)).toBe('68M');
  });
});
