import { useEffect, useLayoutEffect, useRef } from 'react';
import { getMotionGroup, MOTION_MOVES, resolveMotionAt } from 'src/lib/animation/motionClips';
import type { MotionClip } from 'src/lib/animation/motionClips';
import type { SceneMotionValues } from 'src/lib/animation/sceneMotion';
import type { BackgroundSettings } from 'src/lib/effects/frame';
import { frameBackgroundCss } from 'src/lib/effects/frame/backgroundCss';

const LEAD_S = 0.4;
const HOLD_S = 0.6;
const GHOST_OPACITY = 0.3;

// Preview length per group: long enough to read, short enough to loop often.
const previewLength = (clip: MotionClip) => {
  if (MOTION_MOVES[clip.move].sway) {
    return 6;
  }
  if (getMotionGroup(clip) === 'during') {
    return 2.4;
  }
  return Math.min(2.2, Math.max(1, clip.end - clip.start));
};

const poseAt = (c: MotionClip, local: number) => {
  const length = previewLength(c);
  // Preview the move on its own stand-in clip, wherever the real block sits.
  const loop: MotionClip = { ...c, start: 0, end: length, clipId: undefined };
  return resolveMotionAt([loop], [{ id: 'preview', timelineStart: 0, timelineEnd: length }], local);
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** 'loop' plays the move; 'from' / 'to' hold its start or end pose (while editing it). */
export type MotionPreviewMode = 'loop' | 'from' | 'to';

/**
 * A miniature of the canvas: a still of the user's recording on the project's
 * own frame background (so light and dark recordings both read as they will),
 * moved by the real motion engine so the preview matches the export. The
 * animation writes styles straight to the DOM from one rAF loop — no React
 * renders per frame — and stops when the card closes. Changing the clip while
 * it's showing (dragging a slider) repaints without restarting anything.
 */
export const MotionPreviewStage = ({
  clip,
  frame,
  background,
  mode = 'loop',
  label,
}: {
  clip: MotionClip;
  frame: string | null;
  background: BackgroundSettings;
  mode?: MotionPreviewMode;
  label?: string;
}) => {
  const screenRef = useRef<HTMLDivElement>(null);
  const backdrop = frameBackgroundCss(background);
  const progressRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef(clip);

  const paint = (v: SceneMotionValues, held = false) => {
    const el = screenRef.current;
    if (!el) {
      return;
    }
    el.style.transform =
      `translate(${v.x * el.offsetWidth}px, ${v.y * el.offsetHeight}px) scale(${v.scale}) ` +
      `rotateX(${v.tiltX}deg) rotateY(${v.tiltY}deg) rotate(${v.rotation}deg)`;
    // A held pose at 0% would be an empty stage, so it shows as a faint ghost
    // with a dashed outline: you see the pose and that it's transparent.
    const ghost = held && v.opacity < 0.99;
    el.style.opacity = String(held ? Math.max(GHOST_OPACITY, v.opacity) : v.opacity);
    el.style.outline = ghost ? '1px dashed rgba(255,255,255,0.45)' : 'none';
    el.style.outlineOffset = ghost ? '2px' : '0';
  };

  // The loop reads the latest clip from a ref; held poses repaint right away.
  useLayoutEffect(() => {
    clipRef.current = clip;
    if (mode === 'loop') {
      // Reduced motion shows one still pose, so it follows the hovered option.
      if (prefersReducedMotion()) {
        paint(poseAt(clip, previewLength(clip) * 0.4));
      }
      return;
    }
    const length = previewLength(clip);
    paint(poseAt(clip, mode === 'from' ? 0 : length), true);
  });

  useEffect(() => {
    if (mode !== 'loop') {
      return;
    }
    if (prefersReducedMotion()) {
      return;
    }
    let raf = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const c = clipRef.current;
      const length = previewLength(c);
      const cycle = LEAD_S + length + HOLD_S;
      const t = ((now - startedAt) / 1000) % cycle;
      const local = Math.min(length, Math.max(0, t - LEAD_S));
      paint(poseAt(c, local));
      if (progressRef.current) {
        progressRef.current.style.transform = `scaleX(${t / cycle})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  return (
    <div
      className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden border-b border-sf-border bg-[#3e3e46]"
      style={{ perspective: '560px', background: backdrop ?? undefined }}
      aria-hidden
    >
      {/* Blur background: the recording itself, blurred, like the real frame. */}
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

      {label && (
        <span className="absolute left-2.5 top-2.5 rounded-full border border-sf-border-lt/70 bg-sf-bg/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-primary">
          {label}
        </span>
      )}

      {mode === 'loop' && (
        <div className="absolute inset-x-3 bottom-2.5 h-[2px] overflow-hidden rounded-full bg-black/30">
          <div ref={progressRef} className="h-full w-full origin-left scale-x-0 bg-white/85" />
        </div>
      )}
    </div>
  );
};
