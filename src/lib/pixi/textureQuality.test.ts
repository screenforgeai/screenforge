import { describe, expect, it, vi } from 'vitest';
import {
  configureScreenVideoBridgeContext,
  createScreenVideoCanvasSource,
  getScreenVideoCanvasSourceOptions,
  SCREEN_VIDEO_MAG_FILTER,
  SCREEN_VIDEO_MIPMAP_FILTER,
  SCREEN_VIDEO_MIN_FILTER,
  SCREEN_VIDEO_SCALE_MODE,
} from './textureQuality';

vi.mock('pixi.js', () => ({
  CanvasSource: class MockCanvasSource {
    public magFilter: unknown;
    public minFilter: unknown;
    public mipmapFilter: unknown;
    public scaleMode: unknown;

    constructor(options: {
      magFilter?: unknown;
      minFilter?: unknown;
      mipmapFilter?: unknown;
      scaleMode?: unknown;
    }) {
      this.magFilter = options.magFilter;
      this.minFilter = options.minFilter;
      this.mipmapFilter = options.mipmapFilter;
      this.scaleMode = options.scaleMode;
    }
  },
}));

describe('screen video texture quality helpers', () => {
  it('uses linear filtering to avoid jagged zoom magnification and downscale shimmer', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;

    const options = getScreenVideoCanvasSourceOptions(canvas);
    const source = createScreenVideoCanvasSource(canvas);

    expect(options.width).toBe(1920);
    expect(options.height).toBe(1080);
    expect(options.resolution).toBe(1);
    expect(options.scaleMode).toBe(SCREEN_VIDEO_SCALE_MODE);
    expect(options.magFilter).toBe(SCREEN_VIDEO_MAG_FILTER);
    expect(options.minFilter).toBe(SCREEN_VIDEO_MIN_FILTER);
    expect(options.mipmapFilter).toBe(SCREEN_VIDEO_MIPMAP_FILTER);
    expect(source.scaleMode).toBe(SCREEN_VIDEO_SCALE_MODE);
    expect(source.magFilter).toBe(SCREEN_VIDEO_MAG_FILTER);
    expect(source.minFilter).toBe(SCREEN_VIDEO_MIN_FILTER);
    expect(source.mipmapFilter).toBe(SCREEN_VIDEO_MIPMAP_FILTER);
  });

  it('disables smoothing on the bridge canvas context', () => {
    const context = {
      imageSmoothingEnabled: true,
    } as CanvasRenderingContext2D;

    configureScreenVideoBridgeContext(context);

    expect(context.imageSmoothingEnabled).toBe(false);
  });
});
