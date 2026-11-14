/**
 * Screenshot compositing: the same frame (background, padding, rounded
 * corners, shadow, aspect ratio) videos get, plus the annotation layer.
 *
 * Geometry reuses `getFrameGeometry` from the video frame effect and then
 * scales the result so the screenshot itself keeps its native resolution —
 * the padding grows the canvas instead of shrinking the capture.
 */
import {
  DEFAULT_CROP_RECT,
  drawBackground,
  getContainRect,
  getFrameGeometry,
  type BackgroundSettings,
} from 'src/lib/effects/frame';
import {
  HIGHLIGHT_ALPHA,
  TEXT_LINE_HEIGHT,
  getArrowHead,
  getBlurRegion,
  getRenderOrder,
  getShapeBounds,
  getStepNumbers,
  getTextLines,
  type AnnotationShape,
  type ArrowShape,
  type Point,
  type Rect,
  type StepShape,
  type TextShape,
} from './annotations';
import {
  AUTO_THEME_SAMPLE_ROWS,
  activeBarStyle,
  drawWindowBar,
  layoutWindowBar,
  resolveWindowBarTheme,
  topBandBrightness,
  windowBarHeight,
  type ResolvedWindowBarTheme,
  type WindowBarPage,
  type WindowBarSettings,
} from 'src/lib/window-bar';

export const MAX_SCREENSHOT_DIMENSION = 8192;
export const ANNOTATION_FONT_FAMILY = 'Geist, -apple-system, system-ui, sans-serif';

/** A studio look (3D lighting) in place of the flat frame. */
export interface ScreenshotStudio {
  /** Id of a look in `STUDIO_LOOKS`, or null for the flat frame. */
  lookId: string | null;
  /** Where the screenshot sits: a shift from centre, as fractions of the output's width and height. */
  offset: { x: number; y: number };
  /** Depth toward the camera: a share of its distance (0 = the look's own framing). */
  depth: number;
  /** The camera's turn around the screenshot (radians), added to the look's own angle. */
  orbit: { x: number; y: number };
  /** Camera distance as a share of the look's own (1). */
  zoom: number;
  /** The depth-of-field focus point, in capture pixels; null = automatic (the most detailed part). */
  focus: { x: number; y: number } | null;
  /** How much stays completely sharp around the focus point, 0..1. */
  focusRange: number;
  /** Light strength as a share of the look's own (1). */
  lightPower: number;
  /** Blur strength 0..1, or null for the look's own. */
  blur: number | null;
  /** Light size 0..1 (larger: softer shadows), or null for the look's own. */
  lightSize: number | null;
  /** Light handle position (fractions of the output), or null for the look's own light. */
  light: { x: number; y: number } | null;
  /** Behind a wallpaper background, show the look's own studio wall instead of the wallpaper. */
  studioWall?: boolean;
}

export interface ScreenshotStyle {
  frameEnabled: boolean;
  aspectRatioId: string;
  background: BackgroundSettings;
  studio?: ScreenshotStudio;
  /** The window bar over the capture; none when absent or style 'none'. */
  windowBar?: WindowBarSettings;
}

/** With a window bar, a capture is written at least this many pixels per screen point. */
export const WINDOW_BAR_CAPTURE_SCALE = 2;

/** What a capture's window bar needs besides the style: where it was taken. */
export interface ScreenshotWindowInfo {
  /** Image pixels per screen point at capture (2 on Retina); 1 when unknown. */
  scaleFactor: number;
}

export const FLAT_STUDIO: ScreenshotStudio = {
  lookId: null,
  offset: { x: 0, y: 0 },
  depth: 0,
  orbit: { x: 0, y: 0 },
  zoom: 1,
  focus: null,
  focusRange: 0,
  lightPower: 1,
  blur: null,
  lightSize: null,
  light: null,
};

export interface ScreenshotGeometry {
  canvasWidth: number;
  canvasHeight: number;
  /** Where the screenshot lands on the canvas. */
  mediaRect: Rect;
  /** The whole window: the window bar plus mediaRect (mediaRect itself with no bar). */
  windowRect: Rect;
  /** Window bar height in canvas px; 0 with no bar. */
  barHeight: number;
  /** The window's width in screen points, what the bar is laid out for. */
  windowPoints: number;
  /** Canvas pixels per screenshot pixel. */
  scale: number;
  cornerRadius: number;
  shadowBlur: number;
  shadowOpacity: number;
}

function clampRadius(rect: Rect, radius: number): number {
  return Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
}

export function getScreenshotGeometry(
  imageWidth: number,
  imageHeight: number,
  style: ScreenshotStyle,
  maxDimension = MAX_SCREENSHOT_DIMENSION,
  window: ScreenshotWindowInfo = { scaleFactor: 1 },
): ScreenshotGeometry {
  const scaleFactor = window.scaleFactor > 0 ? window.scaleFactor : 1;
  const windowPoints = imageWidth / scaleFactor;
  const barStyle = activeBarStyle(style.windowBar);
  // The bar in screenshot pixels, sized for the window's width in points.
  const barPixels = windowBarHeight(barStyle, windowPoints) * scaleFactor;
  // A bar is drawn sharp at 2x, so a 1x capture is written at 2x around it.
  const upscale = barPixels > 0 ? Math.max(1, WINDOW_BAR_CAPTURE_SCALE / scaleFactor) : 1;
  const windowHeight = imageHeight + barPixels;
  const capScale = Math.min(upscale, maxDimension / Math.max(imageWidth, windowHeight, 1));

  if (!style.frameEnabled) {
    const width = Math.max(1, Math.round(imageWidth * capScale));
    const scale = width / imageWidth;
    const barHeight = barPixels * scale;
    const height = Math.max(1, Math.round(imageHeight * scale + barHeight));
    return {
      canvasWidth: width,
      canvasHeight: height,
      mediaRect: { x: 0, y: barHeight, width, height: height - barHeight },
      windowRect: { x: 0, y: 0, width, height },
      barHeight,
      windowPoints,
      scale,
      cornerRadius: 0,
      shadowBlur: 0,
      shadowOpacity: 0,
    };
  }

  // The frame wraps the whole window (bar and page) like the video frame does.
  const base = getFrameGeometry(
    {
      aspectRatioId: style.aspectRatioId,
      cropRect: DEFAULT_CROP_RECT,
      background: style.background,
    },
    imageWidth,
    windowHeight,
  );

  let k = (imageWidth * upscale) / Math.max(base.mediaRect.width, 1);
  const largest = Math.max(base.canvasWidth, base.canvasHeight) * k;
  if (largest > maxDimension) {
    k *= maxDimension / largest;
  }

  const canvasWidth = Math.max(1, Math.round(base.canvasWidth * k));
  const canvasHeight = Math.max(1, Math.round(base.canvasHeight * k));
  const windowRect = {
    x: base.mediaRect.x * k,
    y: base.mediaRect.y * k,
    width: base.mediaRect.width * k,
    height: base.mediaRect.height * k,
  };
  const scale = windowRect.width / imageWidth;
  const barHeight = barPixels * scale;
  const mediaRect = {
    x: windowRect.x,
    y: windowRect.y + barHeight,
    width: windowRect.width,
    height: windowRect.height - barHeight,
  };
  // Same scaling the video frame uses (render.ts): values are authored at 1080p.
  const unit = canvasHeight / 1080;
  const { cornerRadius, shadowBlur, shadowOpacity } = style.background;

  return {
    canvasWidth,
    canvasHeight,
    mediaRect,
    windowRect,
    barHeight,
    windowPoints,
    scale,
    cornerRadius: clampRadius(windowRect, cornerRadius * unit),
    shadowBlur: shadowOpacity > 0 ? shadowBlur * unit : 0,
    shadowOpacity,
  };
}

/**
 * Where the canvas shows on the editor stage (CSS pixels): fitted inside it,
 * but never larger than one canvas pixel per device pixel. A small area
 * stretched to fill the stage is resampled by the browser and looks blurry.
 */
export function getPreviewRect(
  stageWidth: number,
  stageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  devicePixelRatio: number,
): Rect {
  const fit = getContainRect(stageWidth, stageHeight, canvasWidth, canvasHeight);
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const width = canvasWidth / ratio;
  if (fit.width <= width) {
    return fit;
  }
  const height = canvasHeight / ratio;
  return { x: (stageWidth - width) / 2, y: (stageHeight - height) / 2, width, height };
}

const barThemeCache = new WeakMap<object, ResolvedWindowBarTheme>();

/** Light or dark for an 'auto' bar: the brightness of the capture's top rows, read once per image. */
export function screenshotBarTheme(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
): ResolvedWindowBarTheme {
  const cached = barThemeCache.get(image as object);
  if (cached) {
    return cached;
  }
  let brightness: number | null = null;
  try {
    const rows = Math.min(AUTO_THEME_SAMPLE_ROWS, imageHeight);
    const sample = document.createElement('canvas');
    sample.width = Math.min(imageWidth, 256);
    sample.height = rows;
    const sctx = sample.getContext('2d', { willReadFrequently: true });
    if (sctx) {
      sctx.drawImage(image, 0, 0, imageWidth, rows, 0, 0, sample.width, rows);
      brightness = topBandBrightness(
        sctx.getImageData(0, 0, sample.width, rows).data,
        sample.width,
        rows,
        rows,
      );
    }
  } catch {
    brightness = null;
  }
  const theme = resolveWindowBarTheme('auto', brightness);
  if (brightness !== null) {
    barThemeCache.set(image as object, theme);
  }
  return theme;
}

export function canvasPointFromImage(p: Point, g: ScreenshotGeometry): Point {
  return { x: g.mediaRect.x + p.x * g.scale, y: g.mediaRect.y + p.y * g.scale };
}

export function imagePointFromCanvas(p: Point, g: ScreenshotGeometry): Point {
  return { x: (p.x - g.mediaRect.x) / g.scale, y: (p.y - g.mediaRect.y) / g.scale };
}

export function clientToCanvasPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): Point {
  return {
    x: ((clientX - rect.left) / Math.max(rect.width, 1)) * canvasWidth,
    y: ((clientY - rect.top) / Math.max(rect.height, 1)) * canvasHeight,
  };
}

/** Black on light fills (yellow, white), white on everything else. */
export function getContrastingTextColor(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return '#ffffff';
  }
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#111111' : '#ffffff';
}

function roundRectPath(ctx: CanvasRenderingContext2D, rect: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
}

function drawArrow(ctx: CanvasRenderingContext2D, shape: ArrowShape): void {
  const head = getArrowHead(shape);
  // End the shaft inside the head so the line cap never pokes past the tip.
  const baseX = (head.left.x + head.right.x) / 2;
  const baseY = (head.left.y + head.right.y) / 2;
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(shape.x1, shape.y1);
  ctx.lineTo(baseX, baseY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(head.tip.x, head.tip.y);
  ctx.lineTo(head.left.x, head.left.y);
  ctx.lineTo(head.right.x, head.right.y);
  ctx.closePath();
  ctx.fill();
}

function drawStep(ctx: CanvasRenderingContext2D, shape: StepShape, n: number): void {
  ctx.beginPath();
  ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
  ctx.fillStyle = shape.color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, shape.radius / 8);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.fillStyle = getContrastingTextColor(shape.color);
  ctx.font = `700 ${Math.round(shape.radius * 1.1)}px ${ANNOTATION_FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), shape.x, shape.y + shape.radius * 0.05);
}

function drawText(ctx: CanvasRenderingContext2D, shape: TextShape): void {
  ctx.font = `600 ${shape.fontSize}px ${ANNOTATION_FONT_FAMILY}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, shape.fontSize / 7);
  ctx.strokeStyle = getContrastingTextColor(shape.color) === '#ffffff' ? '#ffffff' : '#111111';
  ctx.fillStyle = shape.color;
  getTextLines(shape.text).forEach((line, i) => {
    const y = shape.y + i * shape.fontSize * TEXT_LINE_HEIGHT;
    ctx.strokeText(line, shape.x, y);
    ctx.fillText(line, shape.x, y);
  });
}

function drawShape(ctx: CanvasRenderingContext2D, shape: AnnotationShape, n: number): void {
  switch (shape.type) {
    case 'highlight':
      ctx.globalAlpha = HIGHLIGHT_ALPHA;
      ctx.fillStyle = shape.color;
      ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
      ctx.globalAlpha = 1;
      break;
    case 'box':
      ctx.strokeStyle = shape.color;
      ctx.lineWidth = shape.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
      break;
    case 'arrow':
      drawArrow(ctx, shape);
      break;
    case 'step':
      drawStep(ctx, shape, n);
      break;
    case 'text':
      drawText(ctx, shape);
      break;
    case 'blur':
      // Drawn in its own pass (needs the source image), see renderScreenshot.
      break;
  }
}

export interface RenderScreenshotOptions {
  image: CanvasImageSource;
  imageWidth: number;
  imageHeight: number;
  style: ScreenshotStyle;
  geometry: ScreenshotGeometry;
  shapes: readonly AnnotationShape[];
  /** Editor only: draws a dashed outline around this shape. Never set for export. */
  selectedId?: string | null;
  /** The page the window bar describes: the capture's window title, when known. */
  windowBarPage?: WindowBarPage | null;
}

/**
 * Compositing order: background → shadow → screenshot (rounded clip) →
 * blur regions (re-drawn from the screenshot) → highlights → boxes → arrows
 * → steps → text → selection outline.
 */
export function renderScreenshot(
  ctx: CanvasRenderingContext2D,
  options: RenderScreenshotOptions,
): void {
  const { image, imageWidth, imageHeight, style, geometry, shapes, selectedId } = options;
  const { canvasWidth, canvasHeight, mediaRect, windowRect, scale, cornerRadius, shadowBlur } =
    geometry;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (style.frameEnabled) {
    drawBackground(ctx, canvasWidth, canvasHeight, style.background, {
      videoSource: { source: image, width: imageWidth, height: imageHeight, ready: true },
    });

    if (shadowBlur > 0) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${geometry.shadowOpacity})`;
      ctx.shadowBlur = shadowBlur;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = shadowBlur * 0.3;
      ctx.fillStyle = '#000';
      roundRectPath(ctx, windowRect, cornerRadius);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.save();
  roundRectPath(ctx, windowRect, cornerRadius);
  ctx.clip();
  ctx.drawImage(image, mediaRect.x, mediaRect.y, mediaRect.width, mediaRect.height);
  if (style.windowBar && geometry.barHeight > 0) {
    // The same bar videos get, as vectors at the output's own resolution.
    const theme =
      style.windowBar.theme === 'auto'
        ? screenshotBarTheme(image, imageWidth, imageHeight)
        : style.windowBar.theme;
    const scene = layoutWindowBar({
      settings: style.windowBar,
      theme,
      width: geometry.windowPoints,
      page: options.windowBarPage ?? null,
    });
    drawWindowBar(ctx, scene, windowRect.x, windowRect.y, windowRect.width / scene.width);
  }

  // Annotations are authored in screenshot pixels.
  ctx.translate(mediaRect.x, mediaRect.y);
  ctx.scale(scale, scale);

  const ordered = getRenderOrder(shapes);
  for (const shape of ordered) {
    if (shape.type !== 'blur') {
      continue;
    }
    const region = getBlurRegion(shape, imageWidth, imageHeight);
    if (!region) {
      continue;
    }
    const { rect, sample, radius } = region;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.filter = `blur(${Math.max(1, radius * scale)}px)`;
    ctx.drawImage(
      image,
      sample.x,
      sample.y,
      sample.width,
      sample.height,
      sample.x,
      sample.y,
      sample.width,
      sample.height,
    );
    ctx.filter = 'none';
    ctx.restore();
  }
  ctx.restore();

  // Everything else may extend past the screenshot into the padding.
  ctx.save();
  ctx.translate(mediaRect.x, mediaRect.y);
  ctx.scale(scale, scale);
  const stepNumbers = getStepNumbers(shapes);
  for (const shape of ordered) {
    drawShape(ctx, shape, stepNumbers.get(shape.id) ?? 0);
  }

  const selected = selectedId ? shapes.find((s) => s.id === selectedId) : undefined;
  if (selected) {
    const bounds = getShapeBounds(selected);
    const pad = 6 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2);
    ctx.setLineDash([]);
  }
  ctx.restore();
}
