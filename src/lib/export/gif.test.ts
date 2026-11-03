import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GIF_EXPORT_FPS,
  DEFAULT_VIDEO_EXPORT_FPS,
  getExportFpsOptions,
  normalizeExportFpsForFormat,
} from './gif';

describe('GIF export fps helpers', () => {
  it('returns GIF-safe fps options for gif exports', () => {
    expect(getExportFpsOptions('gif')).toEqual([20, 25]);
  });

  it('returns video fps options for non-gif exports', () => {
    expect(getExportFpsOptions('mp4')).toEqual([24, 30, 60]);
  });

  it('normalizes gif exports away from video-oriented frame rates', () => {
    expect(normalizeExportFpsForFormat('gif', 60)).toBe(25);
    expect(normalizeExportFpsForFormat('gif', 30)).toBe(25);
    expect(normalizeExportFpsForFormat('gif', 24)).toBe(25);
    expect(normalizeExportFpsForFormat('gif', 20)).toBe(20);
  });

  it('falls back to sane defaults when fps is missing', () => {
    expect(normalizeExportFpsForFormat('gif', undefined)).toBe(DEFAULT_GIF_EXPORT_FPS);
    expect(normalizeExportFpsForFormat('mp4', undefined)).toBe(DEFAULT_VIDEO_EXPORT_FPS);
  });
});
