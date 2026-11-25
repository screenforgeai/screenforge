import { describe, expect, it, vi } from 'vitest';
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

  it('encodes a video frame at thumbnail size, not full resolution', () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockImplementation(function (this: HTMLCanvasElement) {
        return `data:image/jpeg;${this.width}x${this.height}`;
      });
    const video = { videoWidth: 2560, videoHeight: 1440 } as HTMLVideoElement;

    expect(captureFrame(video)).toBe('data:image/jpeg;480x270');
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 480, 270);
    toDataURL.mockRestore();
    vi.restoreAllMocks();
  });
});
