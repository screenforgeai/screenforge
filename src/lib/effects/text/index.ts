import { useStore } from '../../../store';
import type { Effect, CanvasLayer } from '../types';
import type { TextClip } from '../../../types';

const REFERENCE_HEIGHT = 1080;

function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity / 100})`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function computeAlpha(clip: TextClip, t: number): number {
  let alphaIn = 1;
  let alphaOut = 1;

  if (clip.animationIn !== 'none') {
    alphaIn = Math.min(1, (t - clip.start) / Math.max(clip.animationInDuration, 0.001));
  }
  if (clip.animationOut !== 'none') {
    alphaOut = Math.min(1, (clip.end - t) / Math.max(clip.animationOutDuration, 0.001));
  }

  return Math.min(alphaIn, alphaOut);
}

function computeSlideOffset(clip: TextClip, alpha: number, scale: number): number {
  const isSlide =
    clip.animationIn === 'slide-up' ||
    clip.animationIn === 'slide-down' ||
    clip.animationOut === 'slide-up' ||
    clip.animationOut === 'slide-down';
  if (!isSlide) {
    return 0;
  }
  const direction = clip.animationIn === 'slide-up' || clip.animationOut === 'slide-up' ? 1 : -1;
  return direction * (1 - alpha) * 20 * scale;
}

function createTextLayer(): CanvasLayer {
  return {
    phase: 'overlay' as const,
    draw(ctx, t, _sw, _sh, canvasWidth, canvasHeight) {
      const { textClips } = useStore.getState();
      if (textClips.length === 0) {
        return;
      }

      const scale = canvasHeight / REFERENCE_HEIGHT;

      for (const clip of textClips) {
        if (t < clip.start || t > clip.end) {
          continue;
        }

        const alpha = computeAlpha(clip, t);
        if (alpha <= 0) {
          continue;
        }

        const slideOffset = computeSlideOffset(clip, alpha, scale);
        const fontSize = Math.round(clip.fontSize * scale);
        const maxWidth = clip.width * canvasWidth;
        const originX = clip.x * canvasWidth;
        const originY = clip.y * canvasHeight + slideOffset;

        const fontStyle = [
          clip.italic ? 'italic' : '',
          clip.bold ? 'bold' : '',
          `${fontSize}px`,
          `"${clip.fontFamily}", sans-serif`,
        ]
          .filter(Boolean)
          .join(' ');

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = fontStyle;
        ctx.textBaseline = 'top';

        const lines = wrapText(ctx, clip.content, maxWidth);
        const lineHeight = fontSize * 1.35;
        const totalTextHeight = lines.length * lineHeight;

        const pad = Math.round(clip.backgroundPadding * scale);
        const radius = Math.round(clip.backgroundRadius * scale);
        const bgW = maxWidth + pad * 2;
        const bgH =
          clip.height !== undefined ? clip.height * canvasHeight : totalTextHeight + pad * 2;
        const bgX = originX - pad;

        ctx.beginPath();
        ctx.roundRect(bgX, originY - pad, bgW, bgH, radius);
        ctx.fillStyle = hexToRgba(clip.backgroundColor, clip.backgroundOpacity);
        ctx.fill();

        const innerH = bgH - pad * 2;
        const va = clip.verticalAlign ?? 'top';
        const textOffsetY =
          va === 'middle'
            ? (innerH - totalTextHeight) / 2
            : va === 'bottom'
              ? innerH - totalTextHeight
              : 0;

        ctx.fillStyle = hexToRgba(clip.color, clip.colorOpacity);
        ctx.textAlign = clip.align;

        const textX =
          clip.align === 'center'
            ? originX + maxWidth / 2
            : clip.align === 'right'
              ? originX + maxWidth
              : originX;

        for (let i = 0; i < lines.length; i++) {
          const lineY = originY + textOffsetY + i * lineHeight;
          ctx.fillText(lines[i], textX, lineY);

          if (clip.underline) {
            const metrics = ctx.measureText(lines[i]);
            const lineWidth = metrics.width;
            const decorX =
              clip.align === 'center'
                ? textX - lineWidth / 2
                : clip.align === 'right'
                  ? textX - lineWidth
                  : textX;
            const decorH = Math.max(1, Math.round(fontSize * 0.07));
            ctx.fillRect(decorX, lineY + fontSize + 1, lineWidth, decorH);
          }
        }

        ctx.restore();
      }
    },
  };
}

export const textEffect: Effect<null> = {
  id: 'text',
  analyze: () => null,
  createLayer: () => createTextLayer(),
};
