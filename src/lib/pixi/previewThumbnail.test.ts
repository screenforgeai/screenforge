import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capturePreviewThumbnailCanvas,
  fitThumbnailSize,
  registerPreviewFrameRenderer,
  THUMBNAIL_MAX_WIDTH,
} from './previewThumbnail';

describe('preview thumbnails', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shrinks a large frame to the thumbnail width, keeping its shape', () => {
    expect(fitThumbnailSize(2560, 1440)).toEqual({ width: THUMBNAIL_MAX_WIDTH, height: 270 });
  });

  it('never scales a small frame up', () => {
    expect(fitThumbnailSize(320, 200)).toEqual({ width: 320, height: 200 });
  });

  it('has nothing to capture while no preview is live', () => {
    expect(capturePreviewThumbnailCanvas()).toBeNull();
  });

  it('draws a fresh frame and copies it, shrunk, in the same call', () => {
    const preview = document.createElement('canvas');
    preview.width = 1920;
    preview.height = 1080;
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const render = vi.fn(() => {
      // The copy must not have happened yet: it reads the frame this call draws.
      expect(drawImage).not.toHaveBeenCalled();
      return preview;
    });
    const unregister = registerPreviewFrameRenderer(render);

    const thumbnail = capturePreviewThumbnailCanvas();
    unregister();

    expect(render).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(preview, 0, 0, 480, 270);
    expect(thumbnail?.width).toBe(480);
    expect(thumbnail?.height).toBe(270);
    expect(capturePreviewThumbnailCanvas()).toBeNull();
  });

  it('keeps a newer preview registered when an older one unregisters', () => {
    const older = registerPreviewFrameRenderer(() => null);
    const newerCanvas = document.createElement('canvas');
    const unregisterNewer = registerPreviewFrameRenderer(() => newerCanvas);
    older();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    newerCanvas.width = 100;
    newerCanvas.height = 50;
    expect(capturePreviewThumbnailCanvas()?.width).toBe(100);
    unregisterNewer();
  });
});
