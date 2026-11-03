import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME } from '../../store';
import { computeRequestedExportSize, computeTimelineDuration, roundEven } from './planning';

describe('export planning helpers', () => {
  it('computes timeline duration from the last segment end', () => {
    expect(
      computeTimelineDuration(5, [
        { timelineEnd: 1.25 },
        { timelineEnd: 2.75 },
        { timelineEnd: 2.1 },
      ]),
    ).toBe(2.75);
  });

  it('falls back to the recording duration when the timeline has no segments', () => {
    expect(computeTimelineDuration(4.5, [])).toBe(4.5);
  });

  it('outputs correct dimensions for non-16:9 aspect ratios', () => {
    // 4:3 at 720p: geometry is 240×180, scale = min(1280/240, 720/180) = 4 → 960×720
    expect(
      computeRequestedExportSize({ ...DEFAULT_FRAME, aspectRatioId: '4:3' }, 320, 180, '720p'),
    ).toEqual({ width: 960, height: 720 });

    // 9:16 at 1080p: portrait output should be 1080×1920, not letterboxed 16:9
    expect(
      computeRequestedExportSize({ ...DEFAULT_FRAME, aspectRatioId: '9:16' }, 1280, 800, '1080p'),
    ).toEqual({ width: 1080, height: 1920 });

    // 1:1 at 1080p: square output should be 1080×1080
    expect(
      computeRequestedExportSize({ ...DEFAULT_FRAME, aspectRatioId: '1:1' }, 1280, 800, '1080p'),
    ).toEqual({ width: 1080, height: 1080 });

    // 16:9 at 1080p: standard landscape unchanged
    expect(
      computeRequestedExportSize({ ...DEFAULT_FRAME, aspectRatioId: '16:9' }, 1280, 720, '1080p'),
    ).toEqual({ width: 1920, height: 1080 });
  });

  it('rounds export dimensions to even values', () => {
    expect(roundEven(1919.1)).toBe(1920);
    expect(roundEven(719.4)).toBe(720);
    expect(roundEven(321)).toBe(322);
  });
});
