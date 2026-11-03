import { useStore } from '../../../store';
import type { Effect } from '../types';
import type { CaptionSegment, CaptionSettings } from '../../../types';

function findActiveSegment(segments: CaptionSegment[], t: number): CaptionSegment | null {
  return segments.find((s) => t >= s.start && t <= s.end) ?? null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  const int = parseInt(clean.length === 3 ? clean.replace(/./g, '$&$&') : clean, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D,
  segment: CaptionSegment,
  t: number,
  canvasWidth: number,
  canvasHeight: number,
  style: CaptionSettings,
): void {
  const fontSize = Math.round(Math.max(22, Math.min(canvasHeight * 0.045, 64)) * style.fontScale);
  const padX = Math.round(fontSize * 0.8);
  const padY = Math.round(fontSize * 0.45);
  const bottomMargin = Math.round(canvasHeight * 0.07);

  const weight = style.bold ? '600' : '400';
  const slant = style.italic ? 'italic' : 'normal';
  ctx.save();
  ctx.font = `${slant} ${weight} ${fontSize}px ${style.fontFamily}, ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';

  const textWidth = ctx.measureText(segment.text).width;
  const bgWidth = textWidth + padX * 2;
  const bgHeight = Math.round(fontSize * 1.4) + padY * 2;

  const bgX = (canvasWidth - bgWidth) / 2;
  const bgY = (() => {
    if (style.position === 'top') {
      return bottomMargin;
    }
    if (style.position === 'center') {
      return (canvasHeight - bgHeight) / 2;
    }
    return canvasHeight - bgHeight - bottomMargin;
  })();

  if (style.backgroundEnabled) {
    const { r, g, b } = hexToRgb(style.backgroundColor);
    const alpha = style.backgroundOpacity / 100;
    const radius = Math.min(style.backgroundRadius, bgHeight / 2);

    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;

    ctx.beginPath();
    ctx.roundRect(bgX, bgY, bgWidth, bgHeight, radius);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  // Per-word karaoke rendering: active word → highlightColor, past → textColor, future → muted
  const activeWordIdx = segment.words.findIndex((w) => t >= w.start && t <= w.end);
  const baseAlpha = style.textOpacity / 100;
  const textRgb = hexToRgb(style.textColor);
  const highlightRgb = hexToRgb(style.highlightColor);

  ctx.textAlign = 'left';
  const centerY = bgY + bgHeight / 2;
  let wx = bgX + padX;

  segment.words.forEach((word, i) => {
    let rgb: { r: number; g: number; b: number };
    let alpha: number;
    if (activeWordIdx === -1) {
      rgb = textRgb;
      alpha = baseAlpha;
    } else if (i === activeWordIdx) {
      rgb = highlightRgb;
      alpha = baseAlpha;
    } else if (i < activeWordIdx) {
      rgb = textRgb;
      alpha = baseAlpha;
    } else {
      rgb = textRgb;
      alpha = baseAlpha * 0.4;
    }
    ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
    const wordStr = i < segment.words.length - 1 ? `${word.word} ` : word.word;
    ctx.fillText(wordStr, wx, centerY);
    wx += ctx.measureText(wordStr).width;
  });

  ctx.restore();
}

export const captionsEffect: Effect<null> = {
  id: 'captions',

  analyze() {
    return null;
  },

  createLayer() {
    return {
      phase: 'overlay' as const,
      draw(ctx, t, _sw, _sh, canvasWidth, canvasHeight) {
        const { captions } = useStore.getState();
        if (!captions.captionsEnabled || captions.segments.length === 0) {
          return;
        }
        const segment = findActiveSegment(captions.segments, t);
        if (!segment) {
          return;
        }
        drawCaptionOverlay(ctx, segment, t, canvasWidth, canvasHeight, captions);
      },
    };
  },
};
