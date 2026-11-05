import type { ClipTransition, MediaSegment, TransitionType } from '../../types/timeline';
import {
  createMotionClip,
  getMotionGroup,
  getPinnedSegment,
  setClipPoseValue,
} from './motionClips';
import type { MotionClip, MotionMoveId } from './motionClips';

/**
 * Clip transitions (Transition in / out on each clip) were replaced by Motion
 * intros and outros pinned to clips. This converts a project saved before that
 * so it looks the same: every transition that used to render becomes a block.
 */

/** Saved projects carry this from the first save after the switch to Motion. */
export const MOTION_VERSION = 1;

// Before Motion, a clip without a transition faded in for 0.35s by default.
const LEGACY_DEFAULT_IN: ClipTransition = { type: 'fade', duration: 0.35 };
// The fixed fade non-fade transitions added on top of their own movement.
const LEGACY_NON_FADE_ALPHA = 0.18;

// Fade white and Blur have no Motion equivalent; they become a plain fade.
const IN_MOVE: Record<Exclude<TransitionType, 'none'>, MotionMoveId> = {
  fade: 'fadeIn',
  'fade-white': 'fadeIn',
  blur: 'fadeIn',
  'slide-up': 'slideUpIn',
  'slide-down': 'slideDownIn',
  'slide-left': 'slideLeftIn',
  'slide-right': 'slideRightIn',
  grow: 'growIn',
  shrink: 'zoomIn',
};

const OUT_MOVE: Record<Exclude<TransitionType, 'none'>, MotionMoveId> = {
  fade: 'fadeOut',
  'fade-white': 'fadeOut',
  blur: 'fadeOut',
  'slide-up': 'slideUpOut',
  'slide-down': 'slideDownOut',
  'slide-left': 'slideLeftOut',
  'slide-right': 'slideRightOut',
  grow: 'pushThrough',
  shrink: 'zoomOut',
};

const normalizeType = (t: ClipTransition): TransitionType =>
  (t.type as string) === 'fade-black' ? 'fade' : t.type;

export function migrateTransitionsToMotion(
  segments: readonly MediaSegment[],
  motionClips: readonly MotionClip[],
): { mediaSegments: MediaSegment[]; motionClips: MotionClip[] } {
  const sorted = [...segments].sort((a, b) => a.timelineStart - b.timelineStart);
  const added: MotionClip[] = [];
  const hasPinned = (segmentId: string, group: 'start' | 'end') =>
    motionClips.some(
      (c) => getMotionGroup(c) === group && getPinnedSegment(c, sorted)?.id === segmentId,
    );

  for (const seg of sorted) {
    const tIn = seg.transitionIn ?? LEGACY_DEFAULT_IN;
    const inType = normalizeType(tIn);
    // Intros and outros keep their saved length (a zero-length one never showed).
    if (inType !== 'none' && tIn.duration > 0 && !hasPinned(seg.id, 'start')) {
      const len = Math.min(tIn.duration, seg.timelineEnd - seg.timelineStart);
      added.push(
        createMotionClip(IN_MOVE[inType], seg.timelineStart, seg.timelineStart + len, seg.id),
      );
    }
    // On a lone clip the video's opacity stayed at 1, so a fade-out never
    // rendered; slide, grow and shrink still moved it (and blur blurred it).
    const tOut = seg.transitionOut;
    const outType = tOut ? normalizeType(tOut) : 'none';
    const lone = sorted.length === 1;
    const rendered = !lone || (outType !== 'fade' && outType !== 'fade-white');
    // Between clips, a slide, grow, shrink or blur outro also faded the clip out
    // over a fixed 0.18s, even when its own length was zero.
    const fixedFadeOnly =
      tOut?.duration === 0 && !lone && outType !== 'fade' && outType !== 'fade-white';
    if (
      tOut &&
      outType !== 'none' &&
      (tOut.duration > 0 || fixedFadeOnly) &&
      rendered &&
      !hasPinned(seg.id, 'end')
    ) {
      const room = seg.timelineEnd - seg.timelineStart;
      const len = Math.min(fixedFadeOnly ? LEGACY_NON_FADE_ALPHA : tOut.duration, room);
      const outro = createMotionClip(
        fixedFadeOnly ? 'fadeOut' : OUT_MOVE[outType],
        seg.timelineEnd - len,
        seg.timelineEnd,
        seg.id,
      );
      // Blur becomes a plain fade by choice; the moves keep the clip visible.
      added.push(lone && outType !== 'blur' ? setClipPoseValue(outro, 'to', 'opacity', 1) : outro);
    }
  }

  const mediaSegments = segments.map((seg) => {
    const next = { ...seg };
    delete next.transitionIn;
    delete next.transitionOut;
    return next;
  });
  return {
    mediaSegments,
    motionClips: [...motionClips, ...added].sort((a, b) => a.start - b.start),
  };
}
