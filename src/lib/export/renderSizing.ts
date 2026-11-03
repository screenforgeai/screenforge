import { getFrameGeometry } from '../effects/frame';
import type { FrameSettings } from '../effects/frame';

export interface ExportRenderSize {
  renderScale: number;
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

function ceilPixel(value: number): number {
  return Math.max(1, Math.ceil(value));
}

export function computeExportRenderSize(
  frame: FrameSettings,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): ExportRenderSize {
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const baseGeometry = getFrameGeometry(frame, safeSourceWidth, safeSourceHeight);
  // Fit the PixiJS canvas inside the encoder target so the final output-canvas
  // draw is normally a 1:1 copy. Keeping the old native-size render for large
  // sources pushed every frame through a Canvas 2D downscale immediately before
  // VideoFrame construction, which can leave VideoToolbox waiting on pending GPU
  // work. Screen-video downscaling is handled earlier in the bridge canvas where
  // we can use a safer smoothing mode without touching the encoder input canvas.
  const renderScale = Math.min(
    targetWidth / Math.max(baseGeometry.canvasWidth, 1),
    targetHeight / Math.max(baseGeometry.canvasHeight, 1),
  );

  const scaledSourceWidth = ceilPixel(safeSourceWidth * renderScale);
  const scaledSourceHeight = ceilPixel(safeSourceHeight * renderScale);
  const scaledGeometry = getFrameGeometry(frame, scaledSourceWidth, scaledSourceHeight);

  return {
    renderScale,
    sourceWidth: scaledSourceWidth,
    sourceHeight: scaledSourceHeight,
    canvasWidth: ceilPixel(scaledGeometry.canvasWidth),
    canvasHeight: ceilPixel(scaledGeometry.canvasHeight),
  };
}
