import { CanvasSource } from 'pixi.js';

// linear mag: bilinear interpolation during zoom-in. Retina recordings (e.g.
// 3360×2100) are minified to fit the export canvas, so any zoom crosses back to
// magnification at a non-integer scale (~1.2×). nearest at 1.2× produces uneven
// stroke widths (some texels map to 1px, neighbours to 2px). linear gives smooth,
// consistent antialiasing that reads as crisp on high-DPI source material.
export const SCREEN_VIDEO_MAG_FILTER = 'linear';
// linear min/mipmap: smooth antialiasing when the texture is downscaled (export).
export const SCREEN_VIDEO_MIN_FILTER = 'linear';
export const SCREEN_VIDEO_MIPMAP_FILTER = 'linear';
export const SCREEN_VIDEO_SCALE_MODE = 'linear';

export type ScreenVideoCanvasSourceOptions = ConstructorParameters<typeof CanvasSource>[0];

export function getScreenVideoCanvasSourceOptions(
  resource: HTMLCanvasElement,
): ScreenVideoCanvasSourceOptions {
  return {
    resource,
    width: resource.width,
    height: resource.height,
    resolution: 1,
    scaleMode: SCREEN_VIDEO_SCALE_MODE,
    magFilter: SCREEN_VIDEO_MAG_FILTER,
    minFilter: SCREEN_VIDEO_MIN_FILTER,
    mipmapFilter: SCREEN_VIDEO_MIPMAP_FILTER,
    // Retina sources (e.g. 3360×2100) are downscaled to fit the export canvas
    // (e.g. 1920×1080). Without mipmaps, bilinear filtering at ~0.5× produces
    // aliasing on sharp text and UI edges. autoGenerateMipmaps enables trilinear
    // filtering so the GPU samples pre-filtered mip levels instead of the full
    // texture, yielding clean, alias-free downscaling.
    autoGenerateMipmaps: true,
  };
}

export function createScreenVideoCanvasSource(resource: HTMLCanvasElement): CanvasSource {
  return new CanvasSource(getScreenVideoCanvasSourceOptions(resource));
}

export function configureScreenVideoBridgeContext(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null,
): void {
  if (!context) {
    return;
  }
  context.imageSmoothingEnabled = false;
}
