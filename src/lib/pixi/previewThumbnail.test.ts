import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capturePreviewFrameCanvas,
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
    const render = vi.fn(
      (read: (canvas: HTMLCanvasElement) => void, options: { fullResolution: boolean }) => {
        // The copy must not have happened yet: it reads the frame this call draws.
        expect(drawImage).not.toHaveBeenCalled();
        // A thumbnail needs no more pixels than the preview already shows.
        expect(options.fullResolution).toBe(false);
        read(preview);
      },
    );
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
    const older = registerPreviewFrameRenderer(() => undefined);
    const newerCanvas = document.createElement('canvas');
    const unregisterNewer = registerPreviewFrameRenderer((read) => read(newerCanvas));
    older();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    newerCanvas.width = 100;
    newerCanvas.height = 50;
    expect(capturePreviewThumbnailCanvas()?.width).toBe(100);
    unregisterNewer();
  });

  it('asks for a full-resolution frame for a screenshot and keeps its size', () => {
    const preview = document.createElement('canvas');
    preview.width = 2560;
    preview.height = 1440;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    const render = vi.fn(
      (read: (canvas: HTMLCanvasElement) => void, options: { fullResolution: boolean }) => {
        expect(options.fullResolution).toBe(true);
        read(preview);
      },
    );
    const unregister = registerPreviewFrameRenderer(render);

    const shot = capturePreviewFrameCanvas();
    unregister();

    expect(shot?.width).toBe(2560);
    expect(shot?.height).toBe(1440);
    expect(capturePreviewFrameCanvas()).toBeNull();
  });
});
