import { applyEasing } from './easing';
import type { EasePreset } from './types';
import {
  clampMotionProp,
  combineMotion,
  identityMotion,
  lerpMotion,
  SCENE_MOTION_PROPS,
  SCENE_MOTION_SPECS,
} from './sceneMotion';
import type { SceneMotionProp, SceneMotionValues } from './sceneMotion';

/**
 * Motion as blocks on the timeline, like zoom clips. Each block is one named
 * move with an Amount and a Feel. Intros (start moves) are pinned to the start
 * of a clip and outros (end moves) to its end, so they follow the clip when it
 * is trimmed, moved or split — the same job clip transitions used to do. Moves
 * in between ("during") start from wherever the recording already is, and gaps
 * hold that pose, so motion never jumps.
 */
export type MotionGroup = 'start' | 'during' | 'end';
export type MotionMoveId =
  // start
  | 'fadeIn'
  | 'lift'
  | 'rise'
  | 'zoomIn'
  | 'growIn'
  | 'slideUpIn'
  | 'slideDownIn'
  | 'slideLeftIn'
  | 'slideRightIn'
  | 'tiltIn'
  | 'swingIn'
  | 'unfold'
  | 'dropIn'
  // during
  | 'breathe'
  | 'drift'
  | 'float'
  | 'slowPush'
  | 'slowPull'
  | 'orbit'
  | 'panTilt'
  // end
  | 'fadeOut'
  | 'liftAway'
  | 'sink'
  | 'zoomOut'
  | 'slideUpOut'
  | 'slideDownOut'
  | 'slideLeftOut'
  | 'slideRightOut'
  | 'tiltAway'
  | 'swingOut'
  | 'foldDown'
  | 'pushThrough';
export type MotionAmount = 'subtle' | 'default' | 'strong';
export type MotionFeel = 'smooth' | 'snappy' | 'bouncy';

export interface MotionPoses {
  from: SceneMotionValues;
  to: SceneMotionValues;
}

export interface MotionClip {
  id: string;
  move: MotionMoveId;
  /**
   * The media segment (clip) an intro or outro is pinned to. Missing means the
   * first clip for an intro and the last clip for an outro.
   */
  clipId?: string;
  start: number;
  end: number;
  amount: MotionAmount;
  feel: MotionFeel;
  /** Set once someone customizes the start and end; replaces the move's poses. */
  custom?: MotionPoses;
}

export interface LaidOutMotionClip extends MotionClip {
  /** True when the clip had to be shortened to fit a short video. */
  shortened: boolean;
}

/** How a move reads: barely-there, standard, or a dramatic 3D move. Groups the menu. */
export type MotionTone = 'subtle' | 'classic' | 'cinematic';

/**
 * A looping move: the pose at `local` seconds into the clip, for amount factor `f`.
 * Values are absolute (rest = identity); the caller fades it in and out at the ends.
 */
type Sway = (local: number, f: number) => Partial<SceneMotionValues>;

interface MoveSpec {
  group: MotionGroup;
  tone: MotionTone;
  /** Offset from rest the move starts at (start moves) or ends at (end/during moves). */
  pose: Partial<SceneMotionValues>;
  /** Looping moves sway back and forth instead of tweening between two poses. */
  sway?: Sway;
}

const wave = (local: number, period: number, phase = 0) =>
  Math.sin((2 * Math.PI * local) / period + phase);

// Ordered by tone so each menu reads subtle → classic → cinematic.
export const MOTION_MOVES: Record<MotionMoveId, MoveSpec> = {
  fadeIn: { group: 'start', tone: 'subtle', pose: { opacity: 0 } },
  lift: { group: 'start', tone: 'subtle', pose: { y: 0.03, scale: 0.98, opacity: 0 } },
  rise: { group: 'start', tone: 'classic', pose: { y: 0.12, scale: 0.95, opacity: 0 } },
  zoomIn: { group: 'start', tone: 'classic', pose: { scale: 1.25, opacity: 0 } },
  growIn: { group: 'start', tone: 'classic', pose: { scale: 0.75, opacity: 0 } },
  // Slides are named for the direction of travel, like the old clip transitions.
  slideUpIn: { group: 'start', tone: 'classic', pose: { y: 0.4, opacity: 0 } },
  slideDownIn: { group: 'start', tone: 'classic', pose: { y: -0.4, opacity: 0 } },
  slideLeftIn: { group: 'start', tone: 'classic', pose: { x: 0.4, opacity: 0 } },
  slideRightIn: { group: 'start', tone: 'classic', pose: { x: -0.4, opacity: 0 } },
  tiltIn: {
    group: 'start',
    tone: 'cinematic',
    pose: { scale: 0.8, tiltX: 28, tiltY: -18, opacity: 0 },
  },
  swingIn: {
    group: 'start',
    tone: 'cinematic',
    pose: { x: -0.12, scale: 0.9, tiltY: -38, opacity: 0 },
  },
  unfold: {
    group: 'start',
    tone: 'cinematic',
    pose: { y: 0.08, scale: 0.92, tiltX: 55, opacity: 0 },
  },
  dropIn: { group: 'start', tone: 'cinematic', pose: { y: -0.14, tiltX: -14, opacity: 0 } },

  breathe: {
    group: 'during',
    tone: 'subtle',
    pose: {},
    sway: (local, f) => ({
      scale: 1 + 0.02 * f * (0.5 - 0.5 * Math.cos((2 * Math.PI * local) / 6)),
    }),
  },
  drift: { group: 'during', tone: 'subtle', pose: { x: 0.025, y: -0.01 } },
  float: {
    group: 'during',
    tone: 'subtle',
    pose: {},
    sway: (local, f) => ({
      y: 0.012 * f * wave(local, 5),
      tiltX: 2 * f * wave(local, 5, Math.PI / 2),
    }),
  },
  slowPush: { group: 'during', tone: 'classic', pose: { scale: 1.08 } },
  slowPull: { group: 'during', tone: 'classic', pose: { scale: 0.93 } },
  orbit: {
    group: 'during',
    tone: 'cinematic',
    pose: {},
    sway: (local, f) => ({ tiltX: 8 * f, tiltY: 10 * f * wave(local, 8), scale: 1 - 0.12 * f }),
  },
  panTilt: { group: 'during', tone: 'cinematic', pose: { tiltX: 3, tiltY: 9 } },

  fadeOut: { group: 'end', tone: 'subtle', pose: { opacity: 0 } },
  liftAway: { group: 'end', tone: 'subtle', pose: { y: -0.03, scale: 0.98, opacity: 0 } },
  sink: { group: 'end', tone: 'classic', pose: { y: 0.14, scale: 0.95, opacity: 0 } },
  zoomOut: { group: 'end', tone: 'classic', pose: { scale: 0.75, opacity: 0 } },
  slideUpOut: { group: 'end', tone: 'classic', pose: { y: -0.4, opacity: 0 } },
  slideDownOut: { group: 'end', tone: 'classic', pose: { y: 0.4, opacity: 0 } },
  slideLeftOut: { group: 'end', tone: 'classic', pose: { x: -0.4, opacity: 0 } },
  slideRightOut: { group: 'end', tone: 'classic', pose: { x: 0.4, opacity: 0 } },
  tiltAway: {
    group: 'end',
    tone: 'cinematic',
    pose: { scale: 0.8, tiltX: -24, tiltY: 18, opacity: 0 },
  },
  swingOut: {
    group: 'end',
    tone: 'cinematic',
    pose: { x: 0.12, scale: 0.9, tiltY: 38, opacity: 0 },
  },
  foldDown: {
    group: 'end',
    tone: 'cinematic',
    pose: { y: 0.08, scale: 0.92, tiltX: 55, opacity: 0 },
  },
  pushThrough: { group: 'end', tone: 'cinematic', pose: { scale: 1.35, opacity: 0 } },
};

export const MOTION_TONES: readonly MotionTone[] = ['subtle', 'classic', 'cinematic'];

export const MOTION_MOVE_IDS = Object.keys(MOTION_MOVES) as MotionMoveId[];
export const MOTION_GROUPS: readonly MotionGroup[] = ['start', 'during', 'end'];
export const MOTION_AMOUNTS: readonly MotionAmount[] = ['subtle', 'default', 'strong'];
export const MOTION_FEELS: readonly MotionFeel[] = ['smooth', 'snappy', 'bouncy'];

export const movesInGroup = (group: MotionGroup) =>
  MOTION_MOVE_IDS.filter((id) => MOTION_MOVES[id].group === group);

export const getMotionGroup = (clip: Pick<MotionClip, 'move'>) => MOTION_MOVES[clip.move].group;

/** The clips on the timeline, as far as motion needs them. */
export interface MotionSegment {
  id: string;
  timelineStart: number;
  timelineEnd: number;
}

/** Default length of a video's opening intro and closing outro, in seconds. */
export const PINNED_MOVE_LENGTH = 1.6;
/** Default length of an intro or outro at a cut between clips. */
const CUT_MOVE_LENGTH = 0.5;
const MIN_CLIP_LENGTH = 0.3;
const SWAY_RAMP = 1;
const EDGE_EPSILON = 0.001;

const AMOUNT_FACTOR: Record<MotionAmount, number> = { subtle: 0.5, default: 1, strong: 1.6 };

const scaleOffset = (offset: Partial<SceneMotionValues>, factor: number): SceneMotionValues => {
  const pose = identityMotion();
  for (const prop of SCENE_MOTION_PROPS) {
    const value = offset[prop];
    if (value === undefined) {
      continue;
    }
    const rest = SCENE_MOTION_SPECS[prop].identity;
    pose[prop] = clampMotionProp(prop, rest + (value - rest) * factor);
  }
  return pose;
};

/** The pose a clip moves from and to, relative to wherever the recording already is. */
export function getClipPoses(clip: Pick<MotionClip, 'move' | 'amount' | 'custom'>): MotionPoses {
  if (clip.custom) {
    return { from: { ...clip.custom.from }, to: { ...clip.custom.to } };
  }
  const spec = MOTION_MOVES[clip.move];
  const offset = scaleOffset(spec.pose, AMOUNT_FACTOR[clip.amount]);
  return spec.group === 'start'
    ? { from: offset, to: identityMotion() }
    : { from: identityMotion(), to: offset };
}

const preset = (name: EasePreset, intensity: number) => (p: number) =>
  applyEasing({ kind: 'preset', name, intensity }, p);

// Easing direction follows the move: entrances slow down as they land, exits
// speed up as they leave, moves in between ease both ways. People only pick a feel.
const EASES: Record<MotionGroup, Record<MotionFeel, (p: number) => number>> = {
  start: {
    smooth: preset('slowDown', 0.5),
    snappy: preset('slowDown', 1),
    bouncy: preset('overshoot', 0.25),
  },
  during: {
    smooth: preset('gentle', 0.5),
    snappy: preset('snappy', 0.5),
    bouncy: preset('overshoot', 0.25),
  },
  end: {
    smooth: preset('speedUp', 0.5),
    snappy: preset('speedUp', 1),
    bouncy: (p) => 1 - applyEasing({ kind: 'preset', name: 'overshoot', intensity: 0.25 }, 1 - p),
  },
};

const smoothstep = (v: number) => {
  const c = Math.min(1, Math.max(0, v));
  return c * c * (3 - 2 * c);
};

/** A looping move's pose, eased in over the first second and out over the last. */
function swayPose(clip: MotionClip, sway: Sway, local: number): SceneMotionValues {
  const length = clip.end - clip.start;
  const ramp = Math.min(SWAY_RAMP, length / 2);
  const envelope = ramp > 0 ? smoothstep(Math.min(local, length - local) / ramp) : 0;
  return { ...identityMotion(), ...sway(local, AMOUNT_FACTOR[clip.amount] * envelope) };
}

const sortSegments = (segments: readonly MotionSegment[]) =>
  [...segments].sort((a, b) => a.timelineStart - b.timelineStart);

const timelineEndOf = (segments: readonly MotionSegment[]) =>
  segments.reduce((max, s) => Math.max(max, s.timelineEnd), 0);

/** The clip an intro or outro is pinned to, or null if that clip is gone. */
export function getPinnedSegment(
  clip: Pick<MotionClip, 'move' | 'clipId'>,
  segments: readonly MotionSegment[],
): MotionSegment | null {
  const sorted = sortSegments(segments);
  if (clip.clipId) {
    return sorted.find((s) => s.id === clip.clipId) ?? null;
  }
  return getMotionGroup(clip) === 'start' ? (sorted[0] ?? null) : (sorted.at(-1) ?? null);
}

/** The clip under timeline time `t`, if any. */
export function getSegmentAt(segments: readonly MotionSegment[], t: number) {
  return (
    sortSegments(segments).find(
      (s) => t >= s.timelineStart - EDGE_EPSILON && t <= s.timelineEnd + EDGE_EPSILON,
    ) ?? null
  );
}

/**
 * Where each block actually sits: intros at the start of their clip, outros at
 * its end (both shortened to fit a short clip), and moves in between kept out
 * of the pinned ones. Blocks whose clip is gone, or that are squeezed to a
 * sliver, sit out until there is room again.
 */
export function layoutMotionClips(
  clips: readonly MotionClip[],
  segments: readonly MotionSegment[],
): LaidOutMotionClip[] {
  const duration = timelineEndOf(segments);
  const perClip = new Map<
    string,
    { segment: MotionSegment; intro?: MotionClip; outro?: MotionClip }
  >();
  for (const clip of clips) {
    const group = getMotionGroup(clip);
    if (group === 'during') {
      continue;
    }
    const segment = getPinnedSegment(clip, segments);
    if (!segment) {
      continue;
    }
    const entry = perClip.get(segment.id) ?? { segment };
    if (group === 'start' && !entry.intro) {
      entry.intro = clip;
    } else if (group === 'end' && !entry.outro) {
      entry.outro = clip;
    }
    perClip.set(segment.id, entry);
  }

  const pinned: LaidOutMotionClip[] = [];
  for (const { segment, intro, outro } of perClip.values()) {
    const room = segment.timelineEnd - segment.timelineStart;
    let inLen = intro ? Math.min(room, intro.end - intro.start) : 0;
    let outLen = outro ? Math.min(room, outro.end - outro.start) : 0;
    let shortened = false;
    if (inLen + outLen > room && inLen + outLen > 0) {
      const fit = room / (inLen + outLen);
      inLen *= fit;
      outLen *= fit;
      shortened = true;
    }
    if (intro) {
      const start = segment.timelineStart;
      pinned.push({ ...intro, start, end: start + inLen, shortened });
    }
    if (outro) {
      const end = segment.timelineEnd;
      pinned.push({ ...outro, start: end - outLen, end, shortened });
    }
  }

  const laid: LaidOutMotionClip[] = [...pinned];
  for (const clip of clips) {
    if (getMotionGroup(clip) !== 'during') {
      continue;
    }
    let start = Math.max(0, clip.start);
    let end = Math.min(duration, clip.end);
    for (const p of pinned) {
      if (p.start <= start && start < p.end) {
        start = p.end;
      }
    }
    for (const p of pinned) {
      if (start < p.start && p.start < end) {
        end = p.start;
      }
    }
    if (end - start >= MIN_CLIP_LENGTH) {
      laid.push({ ...clip, start, end, shortened: false });
    }
  }
  return laid.sort((a, b) => a.start - b.start);
}

/**
 * The recording's motion at timeline time `t`. Pure, so preview and export
 * agree. An intro always starts fresh, and an outro's end pose doesn't spill
 * into the next clip; moves in between carry on from where the last one left.
 */
export function resolveMotionAt(
  clips: readonly MotionClip[],
  segments: readonly MotionSegment[],
  t: number,
): SceneMotionValues {
  let carry = identityMotion();
  for (const clip of layoutMotionClips(clips, segments)) {
    if (t < clip.start) {
      return carry;
    }
    const group = getMotionGroup(clip);
    const base = group === 'start' ? identityMotion() : carry;
    const length = clip.end - clip.start;
    const { from, to } = getClipPoses(clip);
    if (t <= clip.end) {
      const local = t - clip.start;
      const sway = MOTION_MOVES[clip.move].sway;
      if (sway && !clip.custom) {
        return combineMotion(base, swayPose(clip, sway, local));
      }
      const progress = length > 0 ? local / length : 1;
      const eased = EASES[group][clip.feel](progress);
      return combineMotion(base, lerpMotion(from, to, eased));
    }
    carry = group === 'end' ? identityMotion() : combineMotion(base, to);
  }
  return carry;
}

const newId = () => `motion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function createMotionClip(
  move: MotionMoveId,
  start: number,
  end: number,
  clipId?: string,
): MotionClip {
  return {
    id: newId(),
    move,
    start,
    end,
    amount: 'default',
    feel: 'smooth',
    ...(clipId ? { clipId } : {}),
  };
}

const byStart = (a: MotionClip, b: MotionClip) => a.start - b.start;

/**
 * Adds an intro or outro pinned to `segmentId`, unless that clip already has
 * one (then that one's id is returned, so callers can select it). The video's
 * opening and closing get a tilt; cuts between clips get a quick fade.
 */
export function addPinnedMove(
  clips: readonly MotionClip[],
  segments: readonly MotionSegment[],
  segmentId: string,
  group: Exclude<MotionGroup, 'during'>,
): { clips: MotionClip[]; id: string | null } {
  const sorted = sortSegments(segments);
  const segment = sorted.find((s) => s.id === segmentId);
  if (!segment) {
    return { clips: [...clips], id: null };
  }
  const existing = clips.find(
    (c) => getMotionGroup(c) === group && getPinnedSegment(c, segments)?.id === segmentId,
  );
  if (existing) {
    return { clips: [...clips], id: existing.id };
  }
  const room = segment.timelineEnd - segment.timelineStart;
  const isOpening = group === 'start' && sorted[0]?.id === segmentId;
  const isClosing = group === 'end' && sorted.at(-1)?.id === segmentId;
  const len = Math.min(isOpening || isClosing ? PINNED_MOVE_LENGTH : CUT_MOVE_LENGTH, room / 2);
  const move: MotionMoveId =
    group === 'start' ? (isOpening ? 'tiltIn' : 'fadeIn') : isClosing ? 'tiltAway' : 'fadeOut';
  const added =
    group === 'start'
      ? createMotionClip(move, segment.timelineStart, segment.timelineStart + len, segmentId)
      : createMotionClip(move, segment.timelineEnd - len, segment.timelineEnd, segmentId);
  return { clips: [...clips, added].sort(byStart), id: added.id };
}

/** One click: an intro on the first clip and an outro on the last, unless they exist. */
export function addIntroAndOutro(
  clips: readonly MotionClip[],
  segments: readonly MotionSegment[],
): MotionClip[] {
  const sorted = sortSegments(segments);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) {
    return [...clips];
  }
  const withIntro = addPinnedMove(clips, segments, first.id, 'start').clips;
  return addPinnedMove(withIntro, segments, last.id, 'end').clips;
}

/**
 * Adds the most likely move at `t`: an intro near the start of the clip under
 * the playhead, an outro near its end, otherwise a slow push filling the free
 * space. If a block is already there it is returned instead, so callers can
 * select it.
 */
export function addMotionAt(
  clips: readonly MotionClip[],
  segments: readonly MotionSegment[],
  t: number,
): { clips: MotionClip[]; id: string | null } {
  const laid = layoutMotionClips(clips, segments);
  const hit = laid.find((c) => t >= c.start && t <= c.end);
  if (hit) {
    return { clips: [...clips], id: hit.id };
  }
  const segment = getSegmentAt(segments, t);
  if (!segment) {
    return { clips: [...clips], id: null };
  }
  const room = segment.timelineEnd - segment.timelineStart;
  const edge = Math.min(2.5, room * 0.2);
  const hasPinned = (group: MotionGroup) =>
    laid.some(
      (c) => getMotionGroup(c) === group && getPinnedSegment(c, segments)?.id === segment.id,
    );
  if (t - segment.timelineStart < edge && !hasPinned('start')) {
    return addPinnedMove(clips, segments, segment.id, 'start');
  }
  if (segment.timelineEnd - t < edge && !hasPinned('end')) {
    return addPinnedMove(clips, segments, segment.id, 'end');
  }
  const duration = timelineEndOf(segments);
  const left = Math.max(0, ...laid.filter((c) => c.end <= t).map((c) => c.end));
  const right = Math.min(duration, ...laid.filter((c) => c.start >= t).map((c) => c.start));
  if (right - left < MIN_CLIP_LENGTH) {
    return { clips: [...clips], id: null };
  }
  const added = createMotionClip('slowPush', left, right);
  return { clips: [...clips, added].sort(byStart), id: added.id };
}

/**
 * Applies a timeline move or resize. Intros and outros stay on their clip's
 * edge and only change length; other blocks are kept out of their neighbours.
 */
export function placeMotionClip(
  clips: readonly MotionClip[],
  segments: readonly MotionSegment[],
  id: string,
  start: number,
  end: number,
): MotionClip[] {
  const target = clips.find((c) => c.id === id);
  if (!target) {
    return [...clips];
  }
  const group = getMotionGroup(target);
  const duration = timelineEndOf(segments);
  let length = Math.max(MIN_CLIP_LENGTH, end - start);
  let nextStart: number;

  if (group !== 'during') {
    const segment = getPinnedSegment(target, segments);
    if (!segment) {
      return [...clips];
    }
    length = Math.min(length, segment.timelineEnd - segment.timelineStart);
    nextStart = group === 'start' ? segment.timelineStart : segment.timelineEnd - length;
  } else {
    length = Math.min(length, duration);
    const others = layoutMotionClips(
      clips.filter((c) => c.id !== id),
      segments,
    );
    const center = (start + end) / 2;
    const prevEnd = Math.max(
      0,
      ...others.filter((c) => (c.start + c.end) / 2 <= center).map((c) => c.end),
    );
    const nextBegin = Math.min(
      duration,
      ...others.filter((c) => (c.start + c.end) / 2 > center).map((c) => c.start),
    );
    length = Math.min(length, Math.max(0, nextBegin - prevEnd));
    nextStart = Math.min(Math.max(start, prevEnd), nextBegin - length);
  }

  return clips
    .map((c) => (c.id === id ? { ...c, start: nextStart, end: nextStart + length } : c))
    .sort(byStart);
}

/**
 * Keeps intros and outros on the right clip after the clips change shape (a
 * split): an outro follows whichever clip now ends where its clip used to end,
 * an intro whichever clip starts where its clip used to start.
 */
export function repinMotionClips(
  clips: readonly MotionClip[],
  before: readonly MotionSegment[],
  after: readonly MotionSegment[],
): MotionClip[] {
  return clips.map((clip) => {
    const group = getMotionGroup(clip);
    if (group === 'during') {
      return clip;
    }
    const old = getPinnedSegment(clip, before);
    if (!old) {
      return clip;
    }
    const edge = group === 'start' ? old.timelineStart : old.timelineEnd;
    const match = after.find(
      (s) => Math.abs((group === 'start' ? s.timelineStart : s.timelineEnd) - edge) < EDGE_EPSILON,
    );
    return match && match.id !== clip.clipId ? { ...clip, clipId: match.id } : clip;
  });
}

/**
 * After a ripple delete: blocks on a deleted clip go with it, and every other
 * block's times close up over the deleted ranges, the way zoom clips do. A
 * move left with no length (it sat inside a deleted clip) is dropped.
 */
export function rippleMotionClips(
  clips: readonly MotionClip[],
  deletedIds: ReadonlySet<string>,
  deletedRanges: readonly { start: number; end: number }[],
): MotionClip[] {
  const shift = (t: number) =>
    t - deletedRanges.reduce((acc, r) => acc + Math.max(0, Math.min(t, r.end) - r.start), 0);
  return clips
    .filter((clip) => !clip.clipId || !deletedIds.has(clip.clipId))
    .map((clip) => ({ ...clip, start: shift(clip.start), end: shift(clip.end) }))
    .filter((clip) => clip.end - clip.start > EDGE_EPSILON);
}

export function setClipMove(clip: MotionClip, move: MotionMoveId): MotionClip {
  return { ...resetClipCustom(clip), move };
}

export function swapClipPoses(clip: MotionClip): MotionClip {
  const { from, to } = getClipPoses(clip);
  return { ...clip, custom: { from: to, to: from } };
}

export function setClipPoseValue(
  clip: MotionClip,
  which: keyof MotionPoses,
  prop: SceneMotionProp,
  value: number,
): MotionClip {
  const poses = getClipPoses(clip);
  return {
    ...clip,
    custom: { ...poses, [which]: { ...poses[which], [prop]: clampMotionProp(prop, value) } },
  };
}

export function resetClipCustom(clip: MotionClip): MotionClip {
  const next = { ...clip };
  delete next.custom;
  return next;
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

const isPose = (v: unknown): v is SceneMotionValues =>
  !!v &&
  typeof v === 'object' &&
  SCENE_MOTION_PROPS.every((p) => Number.isFinite((v as Record<string, unknown>)[p]));

/** Accepts anything read from disk and keeps only valid clips. */
export function normalizeMotionClips(raw: unknown): MotionClip[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: MotionClip[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const c = item as Record<string, unknown>;
    if (
      typeof c.id !== 'string' ||
      !isOneOf(MOTION_MOVE_IDS, c.move) ||
      typeof c.start !== 'number' ||
      typeof c.end !== 'number' ||
      !(c.end > c.start)
    ) {
      continue;
    }
    const custom = c.custom as MotionPoses | undefined;
    out.push({
      id: c.id,
      move: c.move,
      start: c.start,
      end: c.end,
      ...(typeof c.clipId === 'string' ? { clipId: c.clipId } : {}),
      amount: isOneOf(MOTION_AMOUNTS, c.amount) ? c.amount : 'default',
      feel: isOneOf(MOTION_FEELS, c.feel) ? c.feel : 'smooth',
      ...(custom && isPose(custom.from) && isPose(custom.to)
        ? { custom: { from: { ...custom.from }, to: { ...custom.to } } }
        : {}),
    });
  }
  return out.sort(byStart);
}

export const cloneMotionClips = (clips: readonly MotionClip[]): MotionClip[] =>
  clips.map((c) => ({
    ...c,
    ...(c.custom ? { custom: { from: { ...c.custom.from }, to: { ...c.custom.to } } } : {}),
  }));
