import { useStore } from '../../../store';
import type { Effect } from '../types';
import {
  analyzeKeyboardData,
  resolveKeyboardCaptionState,
  type KeyboardData,
  type KeyboardCaptionState,
} from './analyze';
import { colorToRgba, resolveKeyboardCaptionPalette, resolveKeyboardCaptionSize } from './style';
import type { ProjectKeyboardSettings } from '../../../types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function transcriptionCaptionBump(canvasHeight: number): number {
  const fontSize = Math.round(Math.max(18, Math.min(canvasHeight * 0.035, 48)));
  const padY = Math.round(fontSize * 0.45);
  const bgH = Math.round(fontSize * 1.4) + padY * 2;
  const gap = Math.round(clamp(canvasHeight * 0.015, 8, 20));
  return bgH + gap;
}

function drawKeyboardCaption(
  ctx: CanvasRenderingContext2D,
  caption: KeyboardCaptionState,
  canvasWidth: number,
  canvasHeight: number,
  keyboard: ProjectKeyboardSettings,
  captionsActive: boolean,
): void {
  if (!caption.visible || caption.keys.length === 0) {
    return;
  }

  const sizeScale = resolveKeyboardCaptionSize(keyboard.size);
  const palette = resolveKeyboardCaptionPalette(keyboard.background);
  const fontSize = clamp(canvasHeight * 0.03 * sizeScale, 16, 42);
  const keyGap = Math.round(clamp(fontSize * 0.45, 6, 12));
  const outerPadX = Math.round(clamp(fontSize * 0.9, 18, 32));
  const outerPadY = Math.round(clamp(fontSize * 0.55, 10, 18));
  const radius = 12;

  ctx.save();
  ctx.font =
    `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, ` +
    'BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';

  const keyWidths = caption.keys.map((key) => Math.ceil(ctx.measureText(key).width));
  const keysWidth =
    keyWidths.reduce((sum, width) => sum + width, 0) + keyGap * Math.max(0, keyWidths.length - 1);
  const backgroundWidth = keysWidth + outerPadX * 2;
  const backgroundHeight = Math.round(fontSize * 1.35) + outerPadY * 2;
  const x = (canvasWidth - backgroundWidth) / 2;
  const bump = captionsActive ? transcriptionCaptionBump(canvasHeight) : 0;
  const y = canvasHeight - backgroundHeight - clamp(canvasHeight * 0.06, 28, 72) - bump;
  const centerX = x + backgroundWidth / 2;
  const centerY = y + backgroundHeight / 2;
  const alpha = clamp(caption.opacity * keyboard.opacity, 0, 1);

  ctx.translate(centerX, centerY);
  ctx.scale(caption.scale, caption.scale);
  ctx.translate(-centerX, -centerY);

  ctx.shadowColor = colorToRgba(palette.shadowColor, palette.shadowAlpha * alpha);
  ctx.shadowBlur = palette.shadowBlur;
  ctx.shadowOffsetY = palette.shadowDistance;
  drawRoundedRect(ctx, x, y, backgroundWidth, backgroundHeight, radius);
  ctx.fillStyle = colorToRgba(palette.panelColor, palette.panelAlpha * alpha);
  ctx.fill();
  ctx.strokeStyle = colorToRgba(palette.panelBorderColor, palette.panelBorderAlpha * alpha);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = colorToRgba(palette.textColor, alpha);
  ctx.textAlign = 'center';
  let keyX = x + outerPadX;
  caption.keys.forEach((key, index) => {
    const width = keyWidths[index];
    ctx.fillText(key, keyX + width / 2, centerY);
    keyX += width + (index < caption.keys.length - 1 ? keyGap : 0);
  });

  ctx.restore();
}

export const keyboardEffect: Effect<KeyboardData> = {
  id: 'keyboard',

  analyze(recording) {
    return analyzeKeyboardData(recording);
  },

  createLayer(data) {
    return {
      phase: 'overlay',
      draw(ctx, t, _sourceWidth, _sourceHeight, canvasWidth, canvasHeight) {
        const { keyboard, captions } = useStore.getState();
        if (!keyboard.enabled || data.comboEvents.length === 0) {
          return;
        }

        const captionsActive = captions.captionsEnabled && captions.segments.length > 0;
        drawKeyboardCaption(
          ctx,
          resolveKeyboardCaptionState(data.comboEvents, t),
          canvasWidth,
          canvasHeight,
          keyboard,
          captionsActive,
        );
      },
    };
  },
};

export {
  analyzeKeyboardData,
  getKeyEvents,
  getTypingWindows,
  getKeyboardCombos,
  mapKeyboardDataToTimeline,
  resolveKeyboardCaptionState,
} from './analyze';
export type { KeyboardData };
