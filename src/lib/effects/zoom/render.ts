import type { CinematicTiltDirection, CinematicTiltMode, ZoomClip } from '../../../types/timeline';
import {
  normalizeCinematicBackgroundFade,
  normalizeCinematicDepth,
  normalizeCinematicFocus,
  normalizeCinematicMotionBlur,
  normalizeCinematicTilt,
  normalizeCinematicTiltDirection,
  normalizeCinematicTiltMode,
} from './clip';

interface CameraState {
  scale: number;
  cx: number;
  cy: number;
  mode: 'auto' | 'manual';
}
interface CursorPos {
  nx: number;
  ny: number;
}
export interface CinematicZoomState {
  amount: number;
  clipId: string | null;
  clipStart: number | null;
  cx: number;
  cy: number;
  focusCx: number;
  focusCy: number;
  envelope: number;
  depth: number;
  focus: number;
  backgroundFade: number;
  tilt: number;
  motionBlur: number;
  mode: ZoomClip['mode'];
  tiltMode: CinematicTiltMode;
  tiltDirection: CinematicTiltDirection;
}

const IDENTITY: CameraState = { scale: 1, cx: 0.5, cy: 0.5, mode: 'manual' };
const CINEMATIC_MIN_RAMP_SECONDS = 0.26;
const INACTIVE_CINEMATIC: CinematicZoomState = {
  amount: 0,
  clipId: null,
  clipStart: null,
  cx: 0.5,
  cy: 0.5,
  focusCx: 0.5,
  focusCy: 0.5,
  envelope: 0,
  depth: 0,
  focus: 0,
  backgroundFade: 0,
  tilt: 0,
  motionBlur: 0,
  mode: 'manual',
  tiltMode: 'static',
  tiltDirection: 'left',
};
const BRIDGE_MAX_GAP = 0.6;

function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c;
}

function smootherStep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Given a cursor position and the current eased scale, returns the camera
 * centre (cx, cy) in [0, 1] that places the cursor at the screen centre.
 * When the cursor is too close to an edge to be centred, the camera goes
 * as far toward the edge as possible.
 *
 * Formula derivation: screen_x = scale * vx + cx * (1 − scale)
 * Setting screen_x = 0.5 and solving for cx gives: cx = (scale * pos − 0.5) / (scale − 1)
 *
 * Near scale ≈ 1 the denominator approaches 0 and the formula blows up.
 * We blend from cursor pos (at scale=1) toward the ideal (at scale=2) to
 * avoid camera jitter at the start of every zoom-in transition.
 */
function cursorToCameraCenter(pos: number, scale: number): number {
  if (scale <= 1.001) {
    return pos;
  }

  const centerEase = smootherStep((scale - 1) / 0.55);
  if (scale < 2) {
    return pos + (pos - 0.5) * centerEase;
  }

  // No clamping here — zoom/index.ts clamps against the padding-extended bounds.
  return (scale * pos - 0.5) / (scale - 1);
}

function findAdjacentClips(
  clips: ZoomClip[],
  t: number,
): { prev: ZoomClip | null; next: ZoomClip | null } {
  if (clips.length === 0) {
    return { prev: null, next: null };
  }

  // Binary search for leftmost clip with start >= t (candidate for `next`).
  let lo = 0;
  let hi = clips.length - 1;
  let nextIdx = clips.length;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (clips[mid].start >= t) {
      nextIdx = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  const next = nextIdx < clips.length ? clips[nextIdx] : null;

  // Scan backward from nextIdx to find the nearest clip that has already ended.
  // Clips are non-overlapping so this resolves in at most 2 iterations.
  let prev: ZoomClip | null = null;
  for (let i = nextIdx - 1; i >= 0; i--) {
    if (clips[i].end <= t) {
      prev = clips[i];
      break;
    }
  }

  return { prev, next };
}

function getBridgeFloorScale(a: ZoomClip, b: ZoomClip, gap: number): number {
  // Use a small epsilon to guard against floating-point imprecision: adjacent clips
  // (gap ≈ 0) must not get the bridge floor — it would prevent the easeOut from
  // reaching 1× and the easeIn from starting at 1×.
  if (gap < 0.001 || gap > BRIDGE_MAX_GAP) {
    return 1;
  }

  const closeness = 1 - gap / BRIDGE_MAX_GAP;
  const carry = clamp(0.38 + closeness * 0.42, 0.38, 0.8);
  return 1 + (Math.min(a.scale, b.scale) - 1) * carry;
}

function getBridgeState(
  prev: ZoomClip | null,
  next: ZoomClip | null,
  t: number,
  cursorPos?: CursorPos,
): CameraState | null {
  if (!prev || !next) {
    return null;
  }

  const gap = next.start - prev.end;
  if (gap <= 0 || gap > BRIDGE_MAX_GAP || t <= prev.end || t >= next.start) {
    return null;
  }

  const progress = clamp((t - prev.end) / gap, 0, 1);
  const scale = getBridgeFloorScale(prev, next, gap);
  const mode = prev.mode === 'manual' && next.mode === 'manual' ? 'manual' : 'auto';
  const cx =
    mode === 'auto' && cursorPos
      ? cursorToCameraCenter(cursorPos.nx, scale)
      : lerp(prev.cx, next.cx, progress);
  const cy =
    mode === 'auto' && cursorPos
      ? cursorToCameraCenter(cursorPos.ny, scale)
      : lerp(prev.cy, next.cy, progress);

  return { scale, cx, cy, mode };
}

function resolveCinematicRampDuration(duration: number, requested: number): number {
  if (duration <= 0) {
    return 0;
  }

  const safeRequested = Number.isFinite(requested) ? Math.max(0, requested) : 0;
  return Math.min(Math.max(safeRequested, CINEMATIC_MIN_RAMP_SECONDS), duration / 2);
}

/**
 * Given the current set of zoom clips and the playhead time `t`,
 * returns the camera state to apply. Returns null when no clip is active.
 *
 * `cursorPos` — when provided, the camera follows the cursor instead of
 * using the clip's fixed centre.
 */
function findActiveClip(clips: ZoomClip[], t: number): ZoomClip | null {
  let lo = 0;
  let hi = clips.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const clip = clips[mid];
    if (t < clip.start) {
      hi = mid - 1;
    } else if (t > clip.end) {
      lo = mid + 1;
    } else {
      return clip;
    }
  }
  return null;
}

export function interpolateCamera(
  clips: ZoomClip[],
  t: number,
  cursorPos?: CursorPos,
): CameraState | null {
  if (clips.length === 0) {
    return null;
  }

  const active = findActiveClip(clips, t);
  if (!active) {
    const { prev, next } = findAdjacentClips(clips, t);
    return getBridgeState(prev, next, t, cursorPos);
  }

  const elapsed = t - active.start;
  const remaining = active.end - t;
  const duration = active.end - active.start;
  if (duration <= 0) {
    return IDENTITY;
  }

  // When easeIn + easeOut exceeds the clip duration, proportionally shrink both
  // so they fit. Without this, the easeIn→easeOut boundary produces a scale jump
  // (e.g. from ~2.0 down to ~1.5 in one frame) for short clips.
  const totalRamp = active.easeIn + active.easeOut;
  const rampScale = totalRamp > duration ? duration / totalRamp : 1;
  const effectiveEaseIn = active.easeIn * rampScale;
  const effectiveEaseOut = active.easeOut * rampScale;

  let progress = 1;
  if (elapsed < effectiveEaseIn) {
    progress = elapsed / effectiveEaseIn;
  } else if (remaining < effectiveEaseOut) {
    progress = remaining / effectiveEaseOut;
  }

  const eased = easeInOut(progress);
  let scale = 1 + (active.scale - 1) * eased;

  const { prev, next } = findAdjacentClips(clips, t);
  if (next && remaining < effectiveEaseOut) {
    scale = Math.max(scale, getBridgeFloorScale(active, next, next.start - active.end));
  }
  if (prev && elapsed < effectiveEaseIn) {
    scale = Math.max(scale, getBridgeFloorScale(prev, active, active.start - prev.end));
  }

  const useManual = active.mode === 'manual' || !cursorPos;

  const cx = useManual || !cursorPos ? active.cx : cursorToCameraCenter(cursorPos.nx, scale);
  const cy = useManual || !cursorPos ? active.cy : cursorToCameraCenter(cursorPos.ny, scale);

  return { scale, cx, cy, mode: active.mode };
}

export function resolveCinematicZoomState(
  clips: ZoomClip[],
  t: number,
  cursorPos?: CursorPos,
): CinematicZoomState {
  const active = findActiveClip(clips, t);
  if (!active || active.preset !== 'cinematic') {
    return INACTIVE_CINEMATIC;
  }

  const duration = active.end - active.start;
  if (duration <= 0) {
    return INACTIVE_CINEMATIC;
  }

  const depth = normalizeCinematicDepth(active.cinematicDepth);
  const focus = normalizeCinematicFocus(active.cinematicFocus);
  const backgroundFade = normalizeCinematicBackgroundFade(active.cinematicBackgroundFade);
  const tilt = normalizeCinematicTilt(active.cinematicTilt);
  const motionBlur = normalizeCinematicMotionBlur(active.cinematicMotionBlur);
  const tiltMode = normalizeCinematicTiltMode(active.cinematicTiltMode);
  const tiltDirection = normalizeCinematicTiltDirection(active.cinematicTiltDirection);

  const elapsed = t - active.start;
  const remaining = active.end - t;
  const cinematicEaseIn = resolveCinematicRampDuration(duration, active.easeIn);
  const cinematicEaseOut = resolveCinematicRampDuration(duration, active.easeOut);
  let progress = 1;
  if (cinematicEaseIn > 0 && elapsed < cinematicEaseIn) {
    progress = elapsed / cinematicEaseIn;
  } else if (cinematicEaseOut > 0 && remaining < cinematicEaseOut) {
    progress = remaining / cinematicEaseOut;
  }

  const envelope = smootherStep(progress);
  if (envelope <= 0) {
    return {
      ...INACTIVE_CINEMATIC,
      clipId: active.id,
      clipStart: active.start,
      cx: active.cx,
      cy: active.cy,
      focusCx: active.cx,
      focusCy: active.cy,
      depth,
      focus,
      backgroundFade,
      tilt,
      motionBlur,
      mode: active.mode,
      tiltMode,
      tiltDirection,
    };
  }

  const useManual = active.mode === 'manual' || !cursorPos;
  const focusCx = useManual || !cursorPos ? active.cx : clamp(cursorPos.nx, 0, 1);
  const focusCy = useManual || !cursorPos ? active.cy : clamp(cursorPos.ny, 0, 1);
  const cx = focusCx;
  const cy = focusCy;

  return {
    amount: envelope,
    clipId: active.id,
    clipStart: active.start,
    cx,
    cy,
    focusCx,
    focusCy,
    envelope,
    depth,
    focus,
    backgroundFade,
    tilt,
    motionBlur,
    mode: active.mode,
    tiltMode,
    tiltDirection,
  };
}
