import { useEffect, useLayoutEffect, useRef } from 'react';
import type { BackgroundSettings } from 'src/lib/effects/frame';
import { frameBackgroundCss } from 'src/lib/effects/frame/backgroundCss';
import { resolveCursorStyle } from 'src/lib/effects/cursor/cursors';
import type { CursorStyleState } from 'src/lib/effects/cursor/cursors';
import {
  MAGNIFIER_RADIUS,
  MAGNIFIER_ZOOM,
  PRESS_SCALE,
  SHRINK_PRESS_SCALE,
  drawCursorEffects,
  drawRipple,
} from 'src/lib/effects/cursor/effects';
import type { CursorClickEffect, CursorEffect } from 'src/lib/effects/cursor/effects';
import type { CursorStyleId } from 'src/lib/effects/cursor/styles';

export interface CursorPreviewSettings {
  style: CursorStyleId;
  clickEffect: CursorClickEffect;
  cursorEffect: CursorEffect;
  clickShrink: boolean;
  color: string;
  label: string;
}

// Where the cursor stops and clicks, as fractions of the recording.
const STOPS: [number, number][] = [
  [0.3, 0.36],
  [0.7, 0.3],
  [0.64, 0.7],
  [0.34, 0.66],
];
const LEG_S = 1.8;
const MOVE_FRACTION = 0.5;
const CLICK_FRACTION = 0.6;
const PRESS_S = 0.18;
// The preview is tiny next to a real export, so the cursor is drawn larger than
// true scale (canvas px per draw unit = stage width / this).
const STAGE_UNITS = 560;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/** Cursor position (fractions of the recording) at time t on the looping path. */
const pathAt = (t: number): [number, number] => {
  const leg = Math.floor(t / LEG_S);
  const f = (t - leg * LEG_S) / LEG_S;
  const from = STOPS[((leg % 4) + 4) % 4];
  const to = STOPS[(((leg + 1) % 4) + 4) % 4];
  const s = ease(Math.min(1, f / MOVE_FRACTION));
  return [from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s];
};

/**
 * A miniature of the canvas for the cursor's hover cards: a still of the user's
 * recording on the project's frame background, with a cursor moving between a
 * few spots and clicking, drawn by the same style and effect code as the export.
 * One rAF loop paints a canvas over the stage; it stops when the card closes.
 */
export const CursorPreviewStage = ({
  settings,
  frame,
  background,
}: {
  settings: CursorPreviewSettings;
  frame: string | null;
  background: BackgroundSettings;
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settingsRef = useRef(settings);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const backdrop = frameBackgroundCss(background);

  useLayoutEffect(() => {
    settingsRef.current = settings;
  });

  useEffect(() => {
    if (!frame) {
      imageRef.current = null;
      return;
    }
    const img = new Image();
    img.src = frame;
    imageRef.current = img;
  }, [frame]);

  useEffect(() => {
    const stage = stageRef.current;
    const screen = screenRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!stage || !screen || !canvas || !ctx) {
      return;
    }

    const paint = (t: number) => {
      const s = settingsRef.current;
      const box = stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(box.width * dpr);
      const height = Math.round(box.height * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const rec = screen.getBoundingClientRect();
      const rx = rec.left - box.left;
      const ry = rec.top - box.top;
      const toStage = ([fx, fy]: [number, number]) => ({
        x: rx + fx * rec.width,
        y: ry + fy * rec.height,
      });
      const scale = box.width / STAGE_UNITS;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const leg = Math.floor(t / LEG_S);
      const f = (t - leg * LEG_S) / LEG_S;
      const cursor = toStage(pathAt(t));

      // Clicks so far that may still be playing (current and previous leg).
      const clicks: { x: number; y: number; t: number; seed: number }[] = [];
      for (let i = leg - 1; i <= leg; i++) {
        const at = (i + CLICK_FRACTION) * LEG_S;
        if (at <= t && at >= 0) {
          clicks.push({ ...toStage(STOPS[(((i + 1) % 4) + 4) % 4]), t: at, seed: i + 1 });
        }
      }
      const latest = clicks.length > 0 ? clicks[clicks.length - 1] : null;

      if (s.cursorEffect === 'magnifier') {
        const radius = MAGNIFIER_RADIUS * scale;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#1b1b20';
        ctx.fill();
        const img = imageRef.current;
        if (img?.complete && img.naturalWidth > 0) {
          ctx.translate(cursor.x, cursor.y);
          ctx.scale(MAGNIFIER_ZOOM, MAGNIFIER_ZOOM);
          ctx.translate(-cursor.x, -cursor.y);
          ctx.drawImage(img, rx, ry, rec.width, rec.height);
        }
        ctx.restore();
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, radius, 0, Math.PI * 2);
        ctx.lineWidth = 2.5 * scale;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }

      drawCursorEffects(ctx, {
        t,
        scale,
        width: box.width,
        height: box.height,
        clickEffect: s.clickEffect,
        cursorEffect: s.cursorEffect,
        cursor,
        clicks,
        pointAt: (time) => (time < 0 ? null : toStage(pathAt(time))),
        sinceClick: latest ? t - latest.t : null,
      });
      if (s.clickEffect === 'ripple') {
        for (const click of clicks) {
          drawRipple(ctx, click.x, click.y, t - click.t, scale);
        }
      }

      const sinceClick = latest ? t - latest.t : Infinity;
      const pressed = sinceClick < PRESS_S;
      const depth = 1 - (s.clickShrink ? SHRINK_PRESS_SCALE : PRESS_SCALE);
      const press = pressed ? 1 - depth * Math.sin((Math.PI * sinceClick) / PRESS_S) : 1;
      // Over the "button" the cursor turns into a hand, as it would on a real link.
      const state: CursorStyleState = f > 0.45 && f < 0.85 ? 'pointer' : 'default';
      ctx.save();
      ctx.translate(cursor.x, cursor.y);
      ctx.scale(scale * press, scale * press);
      resolveCursorStyle(s.style).states[state].draw(ctx, pressed, {
        time: t,
        color: s.color,
        label: s.label,
      });
      ctx.restore();
    };

    if (prefersReducedMotion()) {
      paint(LEG_S * 1.62);
      return;
    }
    let raf = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      paint((now - startedAt) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={stageRef}
      className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden border-b border-sf-border bg-[#3e3e46]"
      style={{ background: backdrop ?? undefined }}
      aria-hidden
    >
      {backdrop === null && frame && (
        <img
          src={frame}
          alt=""
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl brightness-75"
        />
      )}
      <div
        ref={screenRef}
        className="relative aspect-video w-[70%] overflow-hidden rounded-[6px] bg-[#1b1b20] shadow-[0_14px_30px_rgba(0,0,0,0.45)] ring-1 ring-black/25"
      >
        {frame ? (
          <img src={frame} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex flex-col gap-1.5 p-3">
            <div className="h-1.5 w-1/3 rounded-full bg-white/15" />
            <div className="h-1.5 w-1/2 rounded-full bg-white/10" />
            <div className="mt-auto h-8 w-full rounded bg-white/5" />
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
};
