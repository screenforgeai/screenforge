import { describe, expect, it, vi } from 'vitest';
import {
  fitPreviewResolution,
  PREVIEW_BUFFER_STEP_PX,
  resizePreviewRenderer,
} from './createPixiApp';

const fit = (displayWidth: number, displayHeight: number, devicePixelRatio = 1) =>
  fitPreviewResolution({
    logicalWidth: 2560,
    logicalHeight: 1440,
    displayWidth,
    displayHeight,
    devicePixelRatio,
  });

describe('preview resolution', () => {
  it('draws about as many pixels as the preview shows, not the whole recording', () => {
    const resolution = fit(640, 360);
    expect(2560 * resolution).toBeGreaterThanOrEqual(640);
    expect(1440 * resolution).toBeGreaterThanOrEqual(360);
    // Within one buffer step of the shown size.
    expect(2560 * resolution).toBeLessThanOrEqual(640 + PREVIEW_BUFFER_STEP_PX + 1);
  });

  it('sizes to the image as shown inside a wider box (object-fit: contain)', () => {
    // The editor's real case: a 2560×1341 scene in a 1254×373 box shows 712×373.
    const resolution = fitPreviewResolution({
      logicalWidth: 2560,
      logicalHeight: 1341,
      displayWidth: 1254,
      displayHeight: 373,
      devicePixelRatio: 1,
    });
    expect(2560 * resolution).toBeGreaterThanOrEqual(712);
    expect(1341 * resolution).toBeGreaterThanOrEqual(373);
    expect(2560 * resolution).toBeLessThanOrEqual(712 + PREVIEW_BUFFER_STEP_PX);
  });

  it('counts device pixels, so Retina stays sharp', () => {
    const resolution = fit(640, 360, 2);
    expect(2560 * resolution).toBeGreaterThanOrEqual(1280);
    expect(1440 * resolution).toBeGreaterThanOrEqual(720);
  });

  it('never draws above the recording resolution', () => {
    expect(fit(3000, 1700, 2)).toBe(1);
  });

  it('draws at full resolution until the canvas has a layout size', () => {
    expect(fit(0, 0)).toBe(1);
    expect(
      fitPreviewResolution({
        logicalWidth: 0,
        logicalHeight: 0,
        displayWidth: 640,
        displayHeight: 360,
        devicePixelRatio: 1,
      }),
    ).toBe(1);
  });

  it('keeps the same buffer through small size changes, like a divider drag', () => {
    expect(fit(660, 370)).toBe(fit(700, 380));
    expect(fit(660, 370)).not.toBe(fit(900, 506));
  });

  it('gives a whole number of buffer pixels across, so the logical width stays exact', () => {
    for (const width of [333, 640, 911, 1280]) {
      const resolution = fit(width, (width * 9) / 16, 1.5);
      expect(Number.isInteger(Math.round(2560 * resolution * 1e6) / 1e6)).toBe(true);
    }
  });
});

// Behaves like Pixi 8: resizing to the same buffer pixel size updates the view
// texture's source but returns early, so the renderer's layout size (the
// texture frame) keeps its old value until Texture.update() refreshes it.
const pixiLikeRenderer = (width: number, height: number, resolution: number) => {
  const source = {
    width,
    height,
    pixelWidth: Math.round(width * resolution),
    pixelHeight: Math.round(height * resolution),
  };
  const frame = { width, height };
  const texture = {
    source,
    update: vi.fn(() => {
      frame.width = source.width;
      frame.height = source.height;
    }),
  };
  const resize = vi.fn((w: number, h: number, r: number) => {
    const pw = Math.round(w * r);
    const ph = Math.round(h * r);
    source.width = pw / r;
    source.height = ph / r;
    if (pw !== source.pixelWidth || ph !== source.pixelHeight) {
      source.pixelWidth = pw;
      source.pixelHeight = ph;
      texture.update();
    }
  });
  return {
    renderer: {
      resize,
      view: { texture },
      get width() {
        return frame.width;
      },
      get height() {
        return frame.height;
      },
    },
    texture,
  };
};

describe('preview renderer resize', () => {
  it('takes a new layout size even when the buffer keeps its pixel size (crop, then uncrop)', () => {
    // Cropped: 1536x864 at 0.5 -> a 768x432 buffer.
    const { renderer, texture } = pixiLikeRenderer(1536, 864, 0.5);
    // Uncropped and shown just as big: 2560x1440 at 0.3 -> the same 768x432 buffer.
    resizePreviewRenderer(renderer as never, 2560, 1440, 0.3);

    expect(texture.update).toHaveBeenCalled();
    expect(renderer.width).toBeCloseTo(2560);
    expect(renderer.height).toBeCloseTo(1440);
  });

  it('resizes once when the buffer size changes anyway', () => {
    const { renderer } = pixiLikeRenderer(2560, 1440, 0.3);
    resizePreviewRenderer(renderer as never, 2560, 1440, 0.5);

    expect(renderer.resize).toHaveBeenCalledTimes(1);
    expect(renderer.width).toBeCloseTo(2560);
  });
});
