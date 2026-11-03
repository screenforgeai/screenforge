import type { Effect, FrameWrapper } from '../types';
import type { MaskClip } from '../../../types/timeline';
import { useStore } from '../../../store';
import { mapSourceTimeToTimelineTime } from '../../helpers/segments';

let offscreenCanvas: OffscreenCanvas | null = null;

function getOffscreen(width: number, height: number): OffscreenCanvas {
  if (!offscreenCanvas || offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas = new OffscreenCanvas(width, height);
  }
  return offscreenCanvas;
}

function getActiveMasks(masks: MaskClip[], timelineTime: number): MaskClip[] {
  return masks.filter((m) => timelineTime >= m.start && timelineTime < m.end);
}

function toPixels(
  mask: MaskClip,
  canvasWidth: number,
  canvasHeight: number,
): { px: number; py: number; pw: number; ph: number } {
  return {
    px: mask.x * canvasWidth,
    py: mask.y * canvasHeight,
    pw: mask.width * canvasWidth,
    ph: mask.height * canvasHeight,
  };
}

export const maskEffect: Effect<null> = {
  id: 'mask',

  analyze() {
    return null;
  },

  createFrameWrapper(): FrameWrapper {
    return (ctx, next, t, dt, sourceWidth, sourceHeight, canvasWidth, canvasHeight) => {
      next();

      const state = useStore.getState();
      const timelineTime = mapSourceTimeToTimelineTime(state.mediaSegments, t) ?? t;
      const activeMasks = getActiveMasks(state.maskClips, timelineTime);

      if (activeMasks.length === 0) {
        return;
      }

      const blurMasks = activeMasks.filter((m) => m.type === 'blur');
      const solidMasks = activeMasks.filter((m) => m.type === 'solid');

      if (blurMasks.length > 0) {
        const offscreen = getOffscreen(canvasWidth, canvasHeight);
        const offCtx = offscreen.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
        if (offCtx) {
          offCtx.clearRect(0, 0, canvasWidth, canvasHeight);
          offCtx.drawImage(ctx.canvas, 0, 0);

          for (const mask of blurMasks) {
            const { px, py, pw, ph } = toPixels(mask, canvasWidth, canvasHeight);
            if (pw <= 0 || ph <= 0) {
              continue;
            }

            ctx.save();
            ctx.beginPath();
            ctx.rect(px, py, pw, ph);
            ctx.clip();
            ctx.filter = `blur(${mask.blurAmount}px)`;
            // Draw from slightly outside the clip rect to prevent edge darkening
            const pad = mask.blurAmount * 2;
            ctx.drawImage(
              offscreen,
              Math.max(0, px - pad),
              Math.max(0, py - pad),
              Math.min(canvasWidth, pw + pad * 2),
              Math.min(canvasHeight, ph + pad * 2),
              Math.max(0, px - pad),
              Math.max(0, py - pad),
              Math.min(canvasWidth, pw + pad * 2),
              Math.min(canvasHeight, ph + pad * 2),
            );
            ctx.restore();
          }
        }
      }

      for (const mask of solidMasks) {
        const { px, py, pw, ph } = toPixels(mask, canvasWidth, canvasHeight);
        if (pw <= 0 || ph <= 0) {
          continue;
        }
        ctx.save();
        ctx.fillStyle = mask.color;
        ctx.fillRect(px, py, pw, ph);
        ctx.restore();
      }
    };
  },
};
