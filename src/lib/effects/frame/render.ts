import type { Effect, RenderContext } from '../types';
import { useStore } from '../../../store';
import type { BackgroundSettings, FrameSettings } from './index';
import { getFrameGeometry } from './analyze';
import type { FrameGeometry } from './analyze';
import { GRADIENT_PRESETS } from './presets';
import { resolveWallpaperPreset, getWallpaperImage, getWallpaperBitmap } from './wallpapers';
import { WindowBarPainter, sampleTopBandBrightness } from './window-bar';
import { recordingPageVisits } from '../../recording/captureSource';
import { drawWindowBar } from '../../window-bar/canvas';

let blurCanvas: OffscreenCanvas | null = null;
let blurCtx: OffscreenCanvasRenderingContext2D | null = null;
const BLUR_SCALE = 0.25;

let shadowCanvas: OffscreenCanvas | null = null;
let shadowCtx: OffscreenCanvasRenderingContext2D | null = null;

function clampCornerRadius(width: number, height: number, radius: number): number {
  return Math.max(0, Math.min(radius, width / 2, height / 2));
}

function drawSolid(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

function drawGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  settings: BackgroundSettings,
): void {
  let angle: number;
  let stops: Array<{ offset: number; color: string }>;

  if (settings.gradientPresetId === 'custom') {
    angle = settings.gradientAngle;
    stops = [
      { offset: 0, color: settings.gradientFrom },
      { offset: 1, color: settings.gradientTo },
    ];
  } else {
    const preset =
      GRADIENT_PRESETS.find((item) => item.id === settings.gradientPresetId) ?? GRADIENT_PRESETS[0];
    angle = preset.angle;
    stops = preset.stops;
  }

  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const len = Math.sqrt(w * w + h * h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  const gradient = ctx.createLinearGradient(
    cx - cos * len,
    cy - sin * len,
    cx + cos * len,
    cy + sin * len,
  );

  for (const stop of stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

function drawBlur(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  intensity: number,
  renderContext: RenderContext,
): void {
  const source = renderContext.videoSource;
  if (!source || !source.ready) {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const bw = Math.round(w * BLUR_SCALE);
  const bh = Math.round(h * BLUR_SCALE);
  if (!blurCanvas || blurCanvas.width !== bw || blurCanvas.height !== bh) {
    blurCanvas = new OffscreenCanvas(bw, bh);
    blurCtx = blurCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  }

  blurCtx?.drawImage(source.source, 0, 0, bw, bh);

  const blurRadius = Math.round(Math.max(bw, bh) * 0.06 * Math.max(0.1, intensity));
  ctx.filter = `blur(${blurRadius}px) brightness(0.7)`;
  ctx.drawImage(blurCanvas, -4, -4, w + 8, h + 8);
  ctx.filter = 'none';
}

function drawWallpaper(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  const preset = resolveWallpaperPreset(seed);

  // Worker context: use pre-fetched ImageBitmap (no DOM Image available).
  const bitmap = getWallpaperBitmap(preset.url);
  if (bitmap) {
    const scale = Math.max(w / bitmap.width, h / bitmap.height);
    const sw = bitmap.width * scale;
    const sh = bitmap.height * scale;
    ctx.drawImage(bitmap, (w - sw) / 2, (h - sh) / 2, sw, sh);
    return;
  }

  // Main thread: use HTMLImageElement.
  const img = getWallpaperImage(preset.url);
  if (img.complete && img.naturalWidth > 0) {
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = img.naturalWidth * scale;
    const sh = img.naturalHeight * scale;
    ctx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);
    return;
  }

  ctx.fillStyle = '#0d0010';
  ctx.fillRect(0, 0, w, h);
  img.onload = () => img.decode?.();
}

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  settings: BackgroundSettings,
  renderContext: RenderContext,
): void {
  switch (settings.type) {
    case 'solid':
      drawSolid(ctx, w, h, settings.solidColor);
      break;
    case 'gradient':
      drawGradient(ctx, w, h, settings);
      break;
    case 'blur':
      drawBlur(ctx, w, h, settings.blurIntensity, renderContext);
      break;
    case 'wallpaper':
      drawWallpaper(ctx, w, h, settings.wallpaperSeed);
      break;
  }
}

export const frameEffect: Effect<null> = {
  id: 'frame',
  analyze: () => null,

  createFrameWrapper() {
    // ── Per-wrapper caches ────────────────────────────────────────────────────
    // getFrameGeometry is called every RAF tick in the Canvas 2D renderer. Cache
    // the result and only recompute when the frame object reference, source
    // dimensions, or canvas dimensions change. Zustand always creates new object
    // references on mutation so reference equality is a reliable change indicator.
    let lastFrame: FrameSettings | null = null;
    let lastSW = -1;
    let lastSH = -1;
    let cachedGeometry: FrameGeometry | null = null;

    // Shadow bitmap cache — the shadow only depends on background settings and
    // the computed geometry, not on video content. Only re-render when those
    // change instead of clearing and redrawing the OffscreenCanvas every frame.
    let lastShadowKey = '';

    // One bar per wrapper (one video): it settles 'auto' once.
    const windowBar = new WindowBarPainter();

    return (
      ctx,
      next,
      t,
      _dt,
      sourceWidth,
      sourceHeight,
      canvasWidth,
      canvasHeight,
      renderContext,
    ) => {
      const state = useStore.getState();
      const { frame } = state;
      const { background } = frame;
      const { cornerRadius, shadowBlur, shadowOpacity } = background;

      // Recompute geometry only when inputs change.
      if (frame !== lastFrame || sourceWidth !== lastSW || sourceHeight !== lastSH) {
        cachedGeometry = getFrameGeometry(frame, sourceWidth, sourceHeight);
        lastFrame = frame;
        lastSW = sourceWidth;
        lastSH = sourceHeight;
      }
      const geometry = cachedGeometry!;
      const { contentRect, cropRectPixels, mediaRect } = geometry;
      // The preset's radius and shadow wrap the whole window: bar and page.
      const windowRect = geometry.windowRect;

      const scaledRadius = cornerRadius * (canvasHeight / 1080);
      const contentRadius = clampCornerRadius(contentRect.width, contentRect.height, scaledRadius);
      const mediaRadius = clampCornerRadius(windowRect.width, windowRect.height, scaledRadius);

      drawBackground(ctx, canvasWidth, canvasHeight, background, renderContext);

      if (shadowBlur > 0 && shadowOpacity > 0) {
        const scaledBlur = shadowBlur * (canvasHeight / 1080);
        const scaledOffsetY = scaledBlur * 0.3;

        // Build a key from all values that affect the shadow shape. Skip the
        // expensive OffscreenCanvas redraw when nothing changed.
        const shadowKey = `${shadowBlur}|${shadowOpacity}|${cornerRadius}|${windowRect.x}|${windowRect.y}|${windowRect.width}|${windowRect.height}|${contentRect.x}|${contentRect.y}|${contentRect.width}|${contentRect.height}|${canvasWidth}|${canvasHeight}`;

        if (
          !shadowCanvas ||
          shadowCanvas.width !== canvasWidth ||
          shadowCanvas.height !== canvasHeight
        ) {
          shadowCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
          shadowCtx = shadowCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
          lastShadowKey = ''; // force redraw on canvas resize
        }

        if (shadowKey !== lastShadowKey) {
          const sc = shadowCtx;
          if (sc) {
            sc.clearRect(0, 0, canvasWidth, canvasHeight);
            sc.globalCompositeOperation = 'source-over';
            sc.shadowColor = `rgba(0,0,0,${shadowOpacity})`;
            sc.shadowBlur = scaledBlur;
            sc.shadowOffsetX = 0;
            sc.shadowOffsetY = scaledOffsetY;
            sc.fillStyle = '#000';
            sc.beginPath();
            sc.roundRect(
              windowRect.x,
              windowRect.y,
              windowRect.width,
              windowRect.height,
              mediaRadius,
            );
            sc.fill();

            // Punch out the content interior so the shadow only shows in the padding.
            sc.globalCompositeOperation = 'destination-out';
            sc.shadowColor = 'transparent';
            sc.shadowBlur = 0;
            sc.shadowOffsetX = 0;
            sc.shadowOffsetY = 0;
            sc.fillStyle = '#000';
            sc.beginPath();
            sc.roundRect(
              contentRect.x,
              contentRect.y,
              contentRect.width,
              contentRect.height,
              contentRadius,
            );
            sc.fill();
          }
          lastShadowKey = shadowKey;
        }

        if (shadowCtx) {
          ctx.drawImage(shadowCanvas, 0, 0);
        }
      }

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(
        contentRect.x,
        contentRect.y,
        contentRect.width,
        contentRect.height,
        contentRadius,
      );
      ctx.clip();
      ctx.beginPath();
      ctx.roundRect(windowRect.x, windowRect.y, windowRect.width, windowRect.height, mediaRadius);
      ctx.clip();
      ctx.save();
      ctx.translate(mediaRect.x, mediaRect.y);
      ctx.scale(mediaRect.width / cropRectPixels.width, mediaRect.height / cropRectPixels.height);
      ctx.translate(-cropRectPixels.x, -cropRectPixels.y);
      next();
      ctx.restore();

      // The bar sits on top of the page, inside the same rounded window.
      const bar = windowBar.sceneAt(
        frame,
        geometry,
        t,
        { pageVisits: recordingPageVisits(state.recordingResult) },
        () => {
          const source = renderContext.videoSource;
          if (!source?.ready) {
            return null;
          }
          return sampleTopBandBrightness(
            source.source,
            source.width,
            source.height,
            cropRectPixels.y,
          );
        },
      );
      if (bar) {
        drawWindowBar(ctx, bar, windowRect.x, windowRect.y);
      }
      ctx.restore();
    };
  },
};
