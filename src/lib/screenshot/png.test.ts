import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasToPng, createPngUrl, releaseImageUrl } from './png';

describe('screenshot PNG helpers', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:screenforge/1');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('encodes a canvas to PNG bytes with toBlob', async () => {
    const canvas = document.createElement('canvas');
    const toBlob = vi
      .spyOn(canvas, 'toBlob')
      .mockImplementation((cb) => cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })));

    await expect(canvasToPng(canvas)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  });

  it('fails when the canvas cannot be encoded', async () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'toBlob').mockImplementation((cb) => cb(null));
    await expect(canvasToPng(canvas)).rejects.toThrow();
  });

  it('wraps PNG bytes in a blob URL', () => {
    expect(createPngUrl(new Uint8Array([1, 2, 3]))).toBe('blob:screenforge/1');
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBe(3);
  });

  it('revokes blob URLs and leaves data URLs alone', () => {
    releaseImageUrl('blob:screenforge/1');
    releaseImageUrl('data:image/png;base64,AAAA');
    releaseImageUrl(null);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:screenforge/1');
  });
});
