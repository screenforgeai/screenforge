/** Thumbnails are drawn about 260 CSS px wide in the library: 480 px stays sharp on Retina. */
export const THUMBNAIL_MAX_WIDTH = 480;

/**
 * Draws one preview frame and hands the canvas holding it to `read`, in the same
 * task (a WebGL canvas may not keep the frame past it). The preview's buffer is
 * sized to what is shown on screen; with `fullResolution` the frame is drawn at
 * the recording's own pixels instead, then the buffer goes back.
 */
type PreviewFrameRenderer = (
  read: (canvas: HTMLCanvasElement) => void,
  options: { fullResolution: boolean },
) => void;

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
  let copy: HTMLCanvasElement | null = null;
  renderPreviewFrame?.(
    (canvas) => {
      copy = drawThumbnailCanvas(canvas, canvas.width, canvas.height, maxWidth);
    },
    { fullResolution: false },
  );
  return copy;
}

/**
 * Draws a preview frame at the recording's full resolution and copies it onto a
 * 2D canvas (the preview's own buffer is only as big as it is shown). For frame
 * screenshots. Null when no preview is live.
 */
export function capturePreviewFrameCanvas(): HTMLCanvasElement | null {
  let copy: HTMLCanvasElement | null = null;
  renderPreviewFrame?.(
    (canvas) => {
      copy = drawThumbnailCanvas(canvas, canvas.width, canvas.height, Number.POSITIVE_INFINITY);
    },
    { fullResolution: true },
  );
  return copy;
}
