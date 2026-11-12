import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureFromImageFile } from './open-image';

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  set src(value: string) {
    queueMicrotask(() => {
      if (value.includes('broken')) {
        this.onerror?.();
        return;
      }
      this.naturalWidth = 1600;
      this.naturalHeight = 1000;
      this.onload?.();
    });
  }
}

describe('captureFromImageFile', () => {
  let urls: string[];
  beforeEach(() => {
    urls = [];
    vi.stubGlobal('Image', FakeImage);
    // jsdom has no blob: URLs.
    Object.assign(URL, {
      createObjectURL: vi.fn((blob: File) => {
        const url = `blob:${blob.name}`;
        urls.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens a picked image as a screenshot, at its own size', async () => {
    const file = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' });
    expect(await captureFromImageFile(file)).toEqual({
      kind: 'area',
      imageUrl: 'blob:shot.png',
      width: 1600,
      height: 1000,
    });
  });

  it('turns down anything that is not an image', async () => {
    const file = new File(['hi'], 'notes.txt', { type: 'text/plain' });
    expect(await captureFromImageFile(file)).toBeNull();
    expect(urls).toHaveLength(0);
  });

  it('lets go of the file when it cannot be read as an image', async () => {
    const file = new File([new Uint8Array([1])], 'broken.png', { type: 'image/png' });
    expect(await captureFromImageFile(file)).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:broken.png');
  });
});
