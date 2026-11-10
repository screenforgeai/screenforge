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

export const MAX_SCREENSHOT_DIMENSION = 8192;
export const ANNOTATION_FONT_FAMILY = 'Geist, -apple-system, system-ui, sans-serif';

export interface ScreenshotStyle {
  frameEnabled: boolean;
  aspectRatioId: string;
  background: BackgroundSettings;
}

export interface ScreenshotGeometry {
  canvasWidth: number;
  canvasHeight: number;
  /** Where the screenshot lands on the canvas. */
  mediaRect: Rect;
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
): ScreenshotGeometry {
  const capScale = Math.min(1, maxDimension / Math.max(imageWidth, imageHeight, 1));

  if (!style.frameEnabled) {
    const width = Math.max(1, Math.round(imageWidth * capScale));
    const height = Math.max(1, Math.round(imageHeight * capScale));
    return {
      canvasWidth: width,
      canvasHeight: height,
      mediaRect: { x: 0, y: 0, width, height },
      scale: width / imageWidth,
      cornerRadius: 0,
      shadowBlur: 0,
      shadowOpacity: 0,
    };
  }

  const base = getFrameGeometry(
    {
      aspectRatioId: style.aspectRatioId,
      cropRect: DEFAULT_CROP_RECT,
      background: style.background,
    },
    imageWidth,
    imageHeight,
  );

  let k = imageWidth / Math.max(base.mediaRect.width, 1);
  const largest = Math.max(base.canvasWidth, base.canvasHeight) * k;
  if (largest > maxDimension) {
    k *= maxDimension / largest;
  }

  const canvasWidth = Math.max(1, Math.round(base.canvasWidth * k));
  const canvasHeight = Math.max(1, Math.round(base.canvasHeight * k));
  const mediaRect = {
    x: base.mediaRect.x * k,
    y: base.mediaRect.y * k,
    width: base.mediaRect.width * k,
    height: base.mediaRect.height * k,
  };
  // Same scaling the video frame uses (render.ts): values are authored at 1080p.
  const unit = canvasHeight / 1080;
  const { cornerRadius, shadowBlur, shadowOpacity } = style.background;

  return {
    canvasWidth,
    canvasHeight,
    mediaRect,
    scale: mediaRect.width / imageWidth,
    cornerRadius: clampRadius(mediaRect, cornerRadius * unit),
    shadowBlur: shadowOpacity > 0 ? shadowBlur * unit : 0,
    shadowOpacity,
  };
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
  const { canvasWidth, canvasHeight, mediaRect, scale, cornerRadius, shadowBlur } = geometry;

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
      roundRectPath(ctx, mediaRect, cornerRadius);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.save();
  roundRectPath(ctx, mediaRect, cornerRadius);
  ctx.clip();
  ctx.drawImage(image, mediaRect.x, mediaRect.y, mediaRect.width, mediaRect.height);

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
