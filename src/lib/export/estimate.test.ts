import { describe, expect, it } from 'vitest';
import {
  estimateDisplayExportSizeBytes,
  estimateDisplayGifSizeBytes,
  estimateDisplayVideoSizeBytes,
} from './estimate';

describe('estimateDisplayVideoSizeBytes', () => {
  it('uses a screen-recording heuristic closer to actual output than encoder max bitrate', () => {
    expect(
      estimateDisplayVideoSizeBytes({
        quality: 'balanced',
        resolution: '720p',
        fps: 30,
        audioBitrateKbps: 128,
        durationSeconds: 3,
      }),
    ).toBe(1_173_000);
  });

  it('scales with frame rate for video exports', () => {
    const at30 = estimateDisplayVideoSizeBytes({
      quality: 'balanced',
      resolution: '1080p',
      fps: 30,
      audioBitrateKbps: 192,
      durationSeconds: 10,
    });
    const at60 = estimateDisplayVideoSizeBytes({
      quality: 'balanced',
      resolution: '1080p',
      fps: 60,
      audioBitrateKbps: 192,
      durationSeconds: 10,
    });

    expect(at60).toBeGreaterThan(at30 * 1.8);
  });
});

describe('estimateDisplayGifSizeBytes', () => {
  it('estimates palette-based GIF size from resolution, fps, and duration', () => {
    expect(
      estimateDisplayGifSizeBytes({
        resolution: '720p',
        fps: 25,
        durationSeconds: 3,
      }),
    ).toBe(3_456_000);
  });
});

describe('estimateDisplayExportSizeBytes', () => {
  it('routes gif exports through the gif heuristic', () => {
    expect(
      estimateDisplayExportSizeBytes({
        format: 'gif',
        quality: 'balanced',
        resolution: '720p',
        fps: 25,
        audioBitrateKbps: 128,
        durationSeconds: 3,
      }),
    ).toBe(3_456_000);
  });
});
