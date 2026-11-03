import type { CursorType } from '../../../types/index';
import type { ZoomClip } from '../../../types/timeline';
import type { CanvasLayer } from '../types';
import { getFrameGeometry } from '../frame/analyze';
import { interpolateCamera } from '../zoom/render';
import { transformPointWithSharedCamera } from '../zoom/index';
import type { ActivityEvent, MoveEvent, ClickEvent, PressEvent } from './analyze';
import { useStore } from '../../../store';
import { findSegmentAtSourceTime } from '../../helpers/segments';

// ── Ripple ────────────────────────────────────────────────────────────────────

interface Ripple {
  nx: number;
  ny: number;
  createdAt: number;
}

const RIPPLE_DURATION = 0.45;
const STYLE_CROSSFADE_DURATION = 0.12;
const STYLE_SWITCH_HOLD_DURATION = 0.075;
const STYLE_SWITCH_TO_DEFAULT_HOLD_DURATION = 0.14;
const CLICK_PRESS_DURATION = 0.15;

function isPressedAtTime(pressEvents: PressEvent[], t: number): boolean {
  if (pressEvents.length === 0) {
    return false;
  }
  let lo = 0;
  let hi = pressEvents.length - 1;
  let prev = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pressEvents[mid].t <= t) {
      prev = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (prev < 0) {
    return false;
  }
  return pressEvents[prev].isDown;
}

function findLastEventTime(events: ActivityEvent[], t: number): number | null {
  if (events.length === 0) {
    return null;
  }

  let lo = 0;
  let hi = events.length - 1;
  let prev = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t <= t) {
      prev = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return prev >= 0 ? events[prev].t : null;
}

// ── Cursor interpolation ──────────────────────────────────────────────────────

/**
 * Binary-search the move events array for the last event at or before time t.
 * Returns the normalised cursor position, linearly interpolated between the
 * two surrounding events. Snaps (no interpolation) across gaps > 200 ms.
 */
export const interpolateCursor = (
  moveEvents: MoveEvent[],
  t: number,
): { nx: number; ny: number; cursorType: CursorType } | null => {
  if (moveEvents.length === 0) {
    return null;
  }

  let lo = 0;
  let hi = moveEvents.length - 1;
  let prev = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (moveEvents[mid].t <= t) {
      prev = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (prev === -1) {
    return { nx: moveEvents[0].nx, ny: moveEvents[0].ny, cursorType: moveEvents[0].cursorType };
  }
  if (prev === moveEvents.length - 1) {
    return {
      nx: moveEvents[prev].nx,
      ny: moveEvents[prev].ny,
      cursorType: moveEvents[prev].cursorType,
    };
  }

  const a = moveEvents[prev];
  const b = moveEvents[prev + 1];
  const gap = b.t - a.t;

  if (gap > 0.2) {
    return { nx: a.nx, ny: a.ny, cursorType: a.cursorType };
  }

  const alpha = (t - a.t) / gap;

  // Catmull-Rom spline — C1-continuous curve through all control points.
  // Guard: if a neighbouring control point spans a large gap (cut / long pause),
  // duplicate the segment endpoint instead so the curve cannot overshoot.
  const p0 = prev > 0 && a.t - moveEvents[prev - 1].t <= 0.2 ? moveEvents[prev - 1] : a;
  const p3 =
    prev + 2 < moveEvents.length && moveEvents[prev + 2].t - b.t <= 0.2 ? moveEvents[prev + 2] : b;

  const cr = (v0: number, v1: number, v2: number, v3: number, u: number): number => {
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      0.5 *
      (2 * v1 +
        (-v0 + v2) * u +
        (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 +
        (-v0 + 3 * v1 - 3 * v2 + v3) * u3)
    );
  };

  // Clamp to the segment endpoint range — prevents the spline from briefly
  // overshooting the extremum at direction reversals (e.g. cursor decelerating
  // at the top edge), which would otherwise produce a phantom "up-down" dip
  // that the spring faithfully tracks.
  const crClamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    nx: crClamp(cr(p0.nx, a.nx, b.nx, p3.nx, alpha), Math.min(a.nx, b.nx), Math.max(a.nx, b.nx)),
    ny: crClamp(cr(p0.ny, a.ny, b.ny, p3.ny, alpha), Math.min(a.ny, b.ny), Math.max(a.ny, b.ny)),
    cursorType: a.cursorType,
  };
};

// ── Critically-damped spring ──────────────────────────────────────────────────

/**
 * One axis of a critically-damped spring (no overshoot).
 * Based on the exact closed-form solution from theorangeduck.com/page/spring-roll-call.
 *
 * @param pos    Current position
 * @param vel    Current velocity (mutated in place via returned value)
 * @param target Target position
 * @param halflife Seconds for distance-to-target to halve. Smaller = snappier.
 * @param dt     Frame delta time in seconds
 * @returns [newPos, newVel]
 */
function springDamp(
  pos: number,
  vel: number,
  target: number,
  halflife: number,
  dt: number,
): [number, number] {
  const y = 0.6931471805599453 / Math.max(halflife, 1e-5); // ln(2) / halflife
  const j0 = pos - target;
  const j1 = vel + j0 * y;
  const eydt = Math.exp(-y * dt);
  const newPos = eydt * (j0 + j1 * dt) + target;
  const newVel = eydt * (vel - j1 * y * dt);
  return [newPos, newVel];
}

// ── Canvas drawing ────────────────────────────────────────────────────────────

import {
  isCursorStyleStateType,
  resolveCursorStyle,
  resolveCursorStyleState,
  type CursorStyleState,
} from './cursors';

function drawCursorFromStyle(
  ctx: CanvasRenderingContext2D,
  cursorStyle: import('../../../store').CursorStyle,
  state: CursorStyleState,
  pressed: boolean,
): void {
  resolveCursorStyle(cursorStyle).states[state].draw(ctx, pressed);
}

/**
 * Draws the cursor at (cx, cy) in canvas coordinates.
 * `scale` already incorporates canvas resolution + user size setting.
 * `rotation` is in radians — tilt from velocity direction.
 * `clickScale` is a multiplier for the press animation (1.0 = normal, <1 = pressed).
 */
export const drawCursor = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  pressed: boolean,
  cursorType: CursorType = 'default',
  rotation = 0,
  clickScale = 1,
  cursorStyle: import('../../../store').CursorStyle = 'cursor01',
  styleStateOverride?: CursorStyleState,
): void => {
  const s = scale * clickScale;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.scale(s, s);

  switch (cursorType) {
    default:
      drawCursorFromStyle(
        ctx,
        cursorStyle,
        styleStateOverride ?? resolveCursorStyleState(cursorType),
        pressed,
      );
  }
  ctx.restore();
};

/** Click ripple — expanding ring. progress: 0 → 1 over RIPPLE_DURATION seconds. */
const drawRipple = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  progress: number,
): void => {
  const radius = 32 * scale * progress;
  const opacity = (1 - progress) * 0.55;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();
  ctx.restore();
};

/**
 * Applies a directional motion blur to the cursor by drawing several
 * progressively faded ghost copies behind it along the velocity vector.
 */
function drawMotionBlur(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  vx: number, // canvas px/s
  vy: number,
  scale: number,
  pressed: boolean,
  cursorType: CursorType,
  rotation: number,
  clickScale: number,
  dt: number,
  cursorStyle: import('../../../store').CursorStyle,
  styleStateOverride?: CursorStyleState,
): void {
  const speed = Math.sqrt(vx * vx + vy * vy);
  const SPEED_THRESHOLD = 100; // px/s — no blur at rest
  if (speed < SPEED_THRESHOLD) {
    return;
  }

  const STEPS = 6;
  const MAX_OFFSET = Math.min(speed * dt * 3, 36 * scale);

  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const opacity = (1 - t) * 0.18;
    const ox = -(vx / speed) * MAX_OFFSET * t;
    const oy = -(vy / speed) * MAX_OFFSET * t;
    ctx.globalAlpha = opacity;
    drawCursor(
      ctx,
      cx + ox,
      cy + oy,
      scale,
      pressed,
      cursorType,
      rotation,
      clickScale,
      cursorStyle,
      styleStateOverride,
    );
  }
  ctx.globalAlpha = 1;
}

// ── Layer factory ─────────────────────────────────────────────────────────────

/**
 * Creates a cursor CanvasLayer with spring-physics position easing,
 * velocity-driven rotation, click-scale animation, and motion blur.
 * All cursor settings are read live from the store each frame.
 */
export const createCursorLayer = (
  moveEvents: MoveEvent[],
  clickEvents: ClickEvent[],
  pressEvents: PressEvent[],
  activityEvents: ActivityEvent[],
): CanvasLayer => {
  let ripples: Ripple[] = [];

  // Spring state — position (normalised 0–1) and velocity (normalised units/s)
  let posNx = 0;
  let posNy = 0;
  let velNx = 0;
  let velNy = 0;

  // Display velocity — EMA-smoothed version of spring velocity for motion blur / tilt.
  // Decoupled from physics velocity so the clamps that prevent position overshoot cannot
  // cause the motion blur / rotation to snap direction every other frame.
  let dispVelNx = 0;
  let dispVelNy = 0;
  const DISP_VEL_ALPHA = 0.15; // 15% new + 85% old per frame ≈ 5-frame smoothing at 60fps

  // Mild pre-filter on the CR-interpolated cursor before it enters the spring.
  // The CR spline already clamps per-segment, but recorded data can contain genuine
  // single-frame oscillations (ScreenCaptureKit timing artifacts). A fixed EMA with
  // alpha=0.8 damps these while adding only ~4 ms of effective lag — far less than the
  // spring halflife (60 ms) the user already accepts.
  //
  // This replaces the earlier threshold-based jitter filter which caused catastrophic
  // lag buildup (100-200 px) when the cursor made large legitimate jumps.
  let smoothTargetNx = 0;
  let smoothTargetNy = 0;
  const SMOOTH_ALPHA = 0.8; // 80% toward raw each frame ≈ 4 ms effective lag at 60 fps

  // Click-scale spring state
  let clickScalePos = 1;
  let clickScaleVel = 0;

  // Smoothed rotation — prevents jerk when angle wraps across ±π
  let smoothedRotation = 0;
  let rotVel = 0;

  // State transition for style-driven cursor types (default/pointer/text)
  let activeStyleState: CursorStyleState = 'default';
  let previousStyleState: CursorStyleState | null = null;
  let styleStateTransitionStartedAt = 0;
  let pendingStyleState: CursorStyleState | null = null;
  let pendingStyleStateSince = 0;

  let lastT = -1;
  let initialized = false;

  return {
    phase: 'overlay',
    draw(ctx, t, w, h, canvasWidth, canvasHeight, dtArg) {
      const {
        cursorStyle,
        cursorSize,
        cursorClickEffect,
        cursorHalflife,
        cursorMotionBlur,
        cursorMaxTilt,
        cursorHideWhenIdle,
        cursorIdleHideSeconds,
        isCropEditing,
        frame,
        zoomClips,
        mediaSegments,
      } = useStore.getState();

      if (isCropEditing) {
        return;
      }

      const activeSegment = findSegmentAtSourceTime(mediaSegments, t);
      if (activeSegment?.cursorEnabled === false) {
        return;
      }

      const dt = Math.max(0, Math.min(dtArg ?? 0, 0.05));

      // Detect seek/scrub — snap state instead of sliding
      const prevT = lastT;
      const isSeek = prevT >= 0 && Math.abs(t - prevT) > Math.max(0.1, dt * 3);
      lastT = t;

      const geometry = getFrameGeometry(frame, w, h);
      const cropWidth = Math.max(geometry.cropRectPixels.width, 1);
      const cropHeight = Math.max(geometry.cropRectPixels.height, 1);
      const frameScaleX = geometry.mediaRect.width / cropWidth;
      const frameScaleY = geometry.mediaRect.height / cropHeight;
      const frameScale = (frameScaleX + frameScaleY) / 2;

      const toFramePoint = (nx: number, ny: number) => {
        const sx = nx * w;
        const sy = ny * h;
        return {
          x: geometry.mediaRect.x + (sx - geometry.cropRectPixels.x) * frameScaleX,
          y: geometry.mediaRect.y + (sy - geometry.cropRectPixels.y) * frameScaleY,
        };
      };

      // Ripples
      for (const click of clickEvents) {
        if (click.t > (isSeek ? t - 0.001 : prevT) && click.t <= t) {
          ripples.push({ nx: click.nx, ny: click.ny, createdAt: click.t });
        }
      }

      ripples = ripples.filter((r) => {
        const progress = (t - r.createdAt) / RIPPLE_DURATION;
        return progress >= 0 && progress <= 1;
      });

      const pos = interpolateCursor(moveEvents, t);
      if (!pos) {
        return;
      }

      const lastActivityTime = findLastEventTime(activityEvents, t);
      const isVisible =
        !cursorHideWhenIdle ||
        (lastActivityTime !== null && t - lastActivityTime <= cursorIdleHideSeconds);

      // Camera geometry comes from the zoom frame wrapper so the cursor stays
      // aligned with both standard and cinematic zoom transforms.
      const cameraTarget = interpolateCamera(zoomClips as ZoomClip[], t, pos);
      const zoomScale = cameraTarget?.scale ?? 1;
      const baseScale = (h / 1080) * (cursorSize / 100) * frameScale * zoomScale;

      const toCanvasPoint = (nx: number, ny: number) => {
        const framePoint = toFramePoint(nx, ny);
        return transformPointWithSharedCamera(framePoint.x, framePoint.y);
      };

      if (isVisible && cursorClickEffect === 'ripple') {
        for (const ripple of ripples) {
          const progress = (t - ripple.createdAt) / RIPPLE_DURATION;
          const point = toCanvasPoint(ripple.nx, ripple.ny);
          drawRipple(ctx, point.x, point.y, baseScale, progress);
        }
      }

      // Snap on first frame or after seek
      if (!initialized || isSeek) {
        posNx = pos.nx;
        posNy = pos.ny;
        velNx = 0;
        velNy = 0;
        dispVelNx = 0;
        dispVelNy = 0;
        smoothTargetNx = pos.nx;
        smoothTargetNy = pos.ny;
        clickScalePos = 1;
        clickScaleVel = 0;
        smoothedRotation = 0;
        rotVel = 0;
        activeStyleState = resolveCursorStyleState(pos.cursorType);
        previousStyleState = null;
        styleStateTransitionStartedAt = t;
        pendingStyleState = null;
        pendingStyleStateSince = 0;
        initialized = true;
      }

      const isStyleStateCursor = isCursorStyleStateType(pos.cursorType);
      if (isStyleStateCursor) {
        const targetStyleState = resolveCursorStyleState(pos.cursorType);
        if (targetStyleState === activeStyleState) {
          pendingStyleState = null;
          pendingStyleStateSince = 0;
        } else {
          if (pendingStyleState !== targetStyleState) {
            pendingStyleState = targetStyleState;
            pendingStyleStateSince = t;
          } else {
            const holdDuration =
              targetStyleState === 'default'
                ? STYLE_SWITCH_TO_DEFAULT_HOLD_DURATION
                : STYLE_SWITCH_HOLD_DURATION;
            if (t - pendingStyleStateSince >= holdDuration) {
              previousStyleState = activeStyleState;
              activeStyleState = targetStyleState;
              styleStateTransitionStartedAt = t;
              pendingStyleState = null;
              pendingStyleStateSince = 0;
            }
          }
        }
      } else {
        previousStyleState = null;
        pendingStyleState = null;
        pendingStyleStateSince = 0;
      }

      // Compute press/click state once — used both for click-scale spring and drawing.
      const held = isPressedAtTime(pressEvents, t);
      const recentClick = ripples.some((r) => t - r.createdAt < CLICK_PRESS_DURATION);
      const pressed = held || recentClick;

      if (dt > 0) {
        // Advance the mild pre-filter toward the raw cursor position.
        // alpha=0.8 means 80% of the way to raw each frame → effective lag ≈ 4 ms.
        smoothTargetNx = smoothTargetNx * (1 - SMOOTH_ALPHA) + pos.nx * SMOOTH_ALPHA;
        smoothTargetNy = smoothTargetNy * (1 - SMOOTH_ALPHA) + pos.ny * SMOOTH_ALPHA;

        // Guarantee the spring never overshoots the smoothed target.
        //
        // Two complementary clamps:
        //
        // 1. Critical-velocity pre-clamp: a critically-damped spring still
        //    overshoots if vel > |err| * y (the "critical rate"). Clamp the
        //    approach velocity to exactly that rate before each step so the
        //    spring reaches the target with zero residual momentum.
        //    Formula: vel_crit = -err * y  (points toward target)
        //
        // 2. Already-crossed pre-clamp: if the spring is already past the
        //    target and still moving away (lag overshoot from a direction
        //    reversal), zero the velocity before the next step.
        const ySpring = 0.6931471805599453 / cursorHalflife; // ln(2)/halflife
        const errX = posNx - smoothTargetNx;
        const errY = posNy - smoothTargetNy;
        if (errY > 0 && velNy < -errY * ySpring) {
          velNy = -errY * ySpring;
        }
        if (errY < 0 && velNy > -errY * ySpring) {
          velNy = -errY * ySpring;
        }
        if (errX > 0 && velNx < -errX * ySpring) {
          velNx = -errX * ySpring;
        }
        if (errX < 0 && velNx > -errX * ySpring) {
          velNx = -errX * ySpring;
        }
        if ((errY < 0 && velNy < 0) || (errY > 0 && velNy > 0)) {
          velNy = 0;
        }
        if ((errX < 0 && velNx < 0) || (errX > 0 && velNx > 0)) {
          velNx = 0;
        }

        [posNx, velNx] = springDamp(posNx, velNx, smoothTargetNx, cursorHalflife, dt);
        [posNy, velNy] = springDamp(posNy, velNy, smoothTargetNy, cursorHalflife, dt);

        // Smooth the display velocity — physics velocity can oscillate when the clamps
        // zero it then the spring re-accelerates (e.g. raw cursor bouncing). The EMA
        // averages over ~5 frames so motion blur / tilt won't snap direction on every frame.
        dispVelNx = dispVelNx * (1 - DISP_VEL_ALPHA) + velNx * DISP_VEL_ALPHA;
        dispVelNy = dispVelNy * (1 - DISP_VEL_ALPHA) + velNy * DISP_VEL_ALPHA;

        // Click-scale spring: subtle press while held/clicked, then return to normal
        const scaleTarget = pressed ? 0.95 : 1.0;
        // Snappy spring for click feel: short halflife
        [clickScalePos, clickScaleVel] = springDamp(
          clickScalePos,
          clickScaleVel,
          scaleTarget,
          0.04,
          dt,
        );
      }

      // Velocity-driven rotation — cursor tilts into direction of travel.
      // Use the EMA-smoothed display velocity so the tilt/blur don't snap when
      // the physics velocity oscillates due to the overshoot-prevention clamps.
      const cvx = dispVelNx * w * frameScale * zoomScale;
      const cvy = dispVelNy * h * frameScale * zoomScale;
      const speed = Math.sqrt(cvx * cvx + cvy * cvy);
      const MAX_TILT = (cursorMaxTilt * Math.PI) / 180;
      const TILT_SPEED_SCALE = 600; // px/s at which full tilt is reached
      const tiltFactor = Math.min(speed / TILT_SPEED_SCALE, 1);
      const targetRotation =
        speed > 10 ? (Math.atan2(cvy, cvx) * tiltFactor * MAX_TILT) / (Math.PI / 2) : 0;

      // Spring smoothedRotation toward target, handling ±π wrap to prevent jerk.
      // Compute shortest-path diff first, then spring toward the unwrapped target
      // so the spring's velocity carries through cleanly without angle discontinuities.
      let diff = targetRotation - smoothedRotation;
      if (diff > Math.PI) {
        diff -= 2 * Math.PI;
      }
      if (diff < -Math.PI) {
        diff += 2 * Math.PI;
      }
      [smoothedRotation, rotVel] = springDamp(
        smoothedRotation,
        rotVel,
        smoothedRotation + diff,
        0.1,
        dt,
      );
      const rotation = smoothedRotation;
      const cursorPoint = toCanvasPoint(posNx, posNy);
      const cx = cursorPoint.x;
      const cy = cursorPoint.y;

      const transitionProgress =
        previousStyleState && isStyleStateCursor
          ? Math.min((t - styleStateTransitionStartedAt) / STYLE_CROSSFADE_DURATION, 1)
          : 1;

      // Motion blur uses the outgoing style during crossfade so the ghost trail
      // doesn't suddenly change shape mid-transition.
      const motionBlurState = isStyleStateCursor
        ? previousStyleState && transitionProgress < 1
          ? previousStyleState
          : activeStyleState
        : undefined;
      if (isVisible && cursorMotionBlur) {
        drawMotionBlur(
          ctx,
          cx,
          cy,
          cvx,
          cvy,
          baseScale,
          pressed,
          pos.cursorType,
          rotation,
          clickScalePos,
          dt,
          cursorStyle,
          motionBlurState,
        );
      }

      if (!isVisible) {
        return;
      }

      if (previousStyleState && isStyleStateCursor && transitionProgress < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - transitionProgress;
        drawCursor(
          ctx,
          cx,
          cy,
          baseScale,
          pressed,
          pos.cursorType,
          rotation,
          clickScalePos,
          cursorStyle,
          previousStyleState,
        );
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = transitionProgress;
        drawCursor(
          ctx,
          cx,
          cy,
          baseScale,
          pressed,
          pos.cursorType,
          rotation,
          clickScalePos,
          cursorStyle,
          activeStyleState,
        );
        ctx.restore();
      } else {
        if (transitionProgress >= 1) {
          previousStyleState = null;
        }
        drawCursor(
          ctx,
          cx,
          cy,
          baseScale,
          pressed,
          pos.cursorType,
          rotation,
          clickScalePos,
          cursorStyle,
          isStyleStateCursor ? activeStyleState : undefined,
        );
      }
    },
  };
};
