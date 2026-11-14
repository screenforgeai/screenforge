import { getScreenshotGeometry, type ScreenshotStyle } from '../compose';

/** Studio exports stay within this size: larger costs a lot of GPU memory for little visible gain. */
export const MAX_STUDIO_DIMENSION = 3840;

/**
 * Pixel size of a studio render: the same canvas the frame would give (aspect
 * ratio, padding), capped at `MAX_STUDIO_DIMENSION` on its longest side.
 */
export const getStudioOutputSize = (
  imageWidth: number,
  imageHeight: number,
  style: ScreenshotStyle,
): { width: number; height: number } => {
  const g = getScreenshotGeometry(imageWidth, imageHeight, { ...style, frameEnabled: true });
  const k = Math.min(1, MAX_STUDIO_DIMENSION / Math.max(g.canvasWidth, g.canvasHeight, 1));
  return {
    width: Math.max(1, Math.round(g.canvasWidth * k)),
    height: Math.max(1, Math.round(g.canvasHeight * k)),
  };
};
