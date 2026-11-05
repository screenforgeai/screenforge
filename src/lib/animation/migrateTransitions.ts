import type { ClipTransition, MediaSegment, TransitionType } from '../../types/timeline';
import { createMotionClip, getMotionGroup, getPinnedSegment } from './motionClips';
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
const MIN_LENGTH = 0.3;

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
    if (inType !== 'none' && !hasPinned(seg.id, 'start')) {
      const len = Math.min(Math.max(MIN_LENGTH, tIn.duration), seg.timelineEnd - seg.timelineStart);
      added.push(
        createMotionClip(IN_MOVE[inType], seg.timelineStart, seg.timelineStart + len, seg.id),
      );
    }
    // On a lone clip a fade-out never rendered (its opacity stayed at 1); the
    // slide, grow, shrink and blur outros moved the video, so they did.
    const tOut = seg.transitionOut;
    const outType = tOut ? normalizeType(tOut) : 'none';
    const rendered = sorted.length > 1 || (outType !== 'fade' && outType !== 'fade-white');
    if (tOut && outType !== 'none' && rendered && !hasPinned(seg.id, 'end')) {
      const len = Math.min(
        Math.max(MIN_LENGTH, tOut.duration),
        seg.timelineEnd - seg.timelineStart,
      );
      added.push(
        createMotionClip(OUT_MOVE[outType], seg.timelineEnd - len, seg.timelineEnd, seg.id),
      );
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
