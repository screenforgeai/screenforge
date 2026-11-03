import { describe, expect, it } from 'vitest';
import { captureFrame, captureProjectThumbnail, isPixelBufferLikelyBlank } from './utils';

describe('thumbnail helpers', () => {
  it('treats cleared black and transparent pixel buffers as blank', () => {
    expect(isPixelBufferLikelyBlank(new Uint8ClampedArray([0, 0, 0, 255]))).toBe(true);
    expect(isPixelBufferLikelyBlank(new Uint8ClampedArray([255, 255, 255, 0]))).toBe(true);
  });

  it('keeps visibly non-black pixel buffers', () => {
    expect(isPixelBufferLikelyBlank(new Uint8ClampedArray([18, 18, 18, 255]))).toBe(false);
    expect(isPixelBufferLikelyBlank(new Uint8ClampedArray([255, 255, 255, 255]))).toBe(false);
  });

  it('keeps the existing thumbnail when the preview canvas has no drawable size', () => {
    const thumbnail = captureProjectThumbnail({
      canvas: { width: 0, height: 0 } as HTMLCanvasElement,
      existingThumbnail: 'data:image/jpeg;base64,existing',
    });

    expect(thumbnail).toBe('data:image/jpeg;base64,existing');
  });

  it('does not try to capture an unloaded video frame', () => {
    const thumbnail = captureFrame({
      videoWidth: 0,
      videoHeight: 1080,
    } as HTMLVideoElement);

    expect(thumbnail).toBe('');
  });
});
