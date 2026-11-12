import type { WindowBarOp, WindowBarScene } from './layout';
import { WINDOW_BAR_FONT, WINDOW_BAR_FONT_WEIGHT } from './tokens';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawOp(ctx: Ctx2D, op: WindowBarOp): void {
  switch (op.kind) {
    case 'rect': {
      ctx.beginPath();
      ctx.roundRect(op.x, op.y, op.w, op.h, op.r);
      ctx.fillStyle = op.fill;
      ctx.fill();
      if (op.stroke && op.strokeWidth) {
        const inset = op.strokeWidth / 2;
        ctx.beginPath();
        ctx.roundRect(
          op.x + inset,
          op.y + inset,
          op.w - op.strokeWidth,
          op.h - op.strokeWidth,
          Math.max(0, op.r - inset),
        );
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.strokeWidth;
        ctx.stroke();
      }
      return;
    }
    case 'circle': {
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.r, 0, Math.PI * 2);
      ctx.fillStyle = op.fill;
      ctx.fill();
      if (op.stroke && op.strokeWidth) {
        ctx.beginPath();
        ctx.arc(op.cx, op.cy, op.r - op.strokeWidth / 2, 0, Math.PI * 2);
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = op.strokeWidth;
        ctx.stroke();
      }
      return;
    }
    case 'icon': {
      ctx.save();
      ctx.globalAlpha *= op.alpha;
      ctx.translate(op.x, op.y);
      const scale = op.size / op.box;
      ctx.scale(scale, scale);
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(op.d));
      ctx.restore();
      return;
    }
    case 'text': {
      ctx.save();
      ctx.globalAlpha *= op.alpha;
      ctx.font = `${WINDOW_BAR_FONT_WEIGHT} ${op.size}px ${WINDOW_BAR_FONT}`;
      ctx.textAlign = op.align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = op.color;
      ctx.fillText(op.text, op.x, op.y);
      ctx.restore();
    }
  }
}

/**
 * Paints a laid-out bar with its top-left corner at x, y, `scale` canvas
 * pixels per layout unit. Vector all the way, so it stays sharp at any
 * output size. Rounded window corners are the caller's clip.
 */
export function drawWindowBar(ctx: Ctx2D, scene: WindowBarScene, x = 0, y = 0, scale = 1): void {
  if (scene.height <= 0) {
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  for (const op of scene.ops) {
    drawOp(ctx, op);
  }
  ctx.restore();
}
