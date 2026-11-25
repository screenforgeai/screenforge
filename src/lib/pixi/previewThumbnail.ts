/** Thumbnails are drawn about 260 CSS px wide in the library: 480 px stays sharp on Retina. */
export const THUMBNAIL_MAX_WIDTH = 480;

/**
 * Draws one preview frame and returns the canvas it went to. A WebGL canvas
 * without preserveDrawingBuffer only holds that frame until the current task
 * ends, so read it right away.
 */
type PreviewFrameRenderer = () => HTMLCanvasElement | null;

let renderPreviewFrame: PreviewFrameRenderer | null = null;

/** The live preview registers how to draw a frame on demand; returns the unregister. */
export function registerPreviewFrameRenderer(renderer: PreviewFrameRenderer): () => void {
  renderPreviewFrame = renderer;
  return () => {
    if (renderPreviewFrame === renderer) {
      renderPreviewFrame = null;
    }
  };
}

/** Width and height that fit `maxWidth`, keeping the aspect ratio; never scales up. */
export function fitThumbnailSize(
  width: number,
  height: number,
  maxWidth: number = THUMBNAIL_MAX_WIDTH,
): { width: number; height: number } {
  if (width <= maxWidth) {
    return { width, height };
  }
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

/** Copies `source` onto a new 2D canvas no wider than `maxWidth`; null if it has no size. */
export function drawThumbnailCanvas(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number = THUMBNAIL_MAX_WIDTH,
): HTMLCanvasElement | null {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }
  const { width, height } = fitThumbnailSize(sourceWidth, sourceHeight, maxWidth);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * Draws a preview frame and copies it, shrunk, onto a small 2D canvas in the
 * same task. Null when no preview is live.
 */
export function capturePreviewThumbnailCanvas(
  maxWidth: number = THUMBNAIL_MAX_WIDTH,
): HTMLCanvasElement | null {
  const canvas = renderPreviewFrame?.() ?? null;
  if (!canvas) {
    return null;
  }
  return drawThumbnailCanvas(canvas, canvas.width, canvas.height, maxWidth);
}
