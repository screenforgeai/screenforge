import type { TimelineAction } from '@xzdarcy/timeline-engine';
import type {
  CameraClip,
  MaskClip,
  ZoomClip,
  MediaSegment,
  ClipTransition,
} from '../../types/timeline';
import { NO_CLIP_TRANSITION } from '../../types/timeline';
import { getMotionGroup, layoutMotionClips, rippleMotionClips } from '../animation/motionClips';
import type { MotionClip } from '../animation/motionClips';
import type { TextClip } from '../../types';
import type { MusicClip } from '../timeline';

export const MIN_MEDIA_SEGMENT_DURATION = 0.1;
export const MIN_ZOOM_CLIP_DURATION = 0.05;
export type MediaTrack = 'video' | 'audio';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createInitialMediaSegments(duration: number): MediaSegment[] {
  if (duration <= 0) {
    return [];
  }

  return [
    {
      id: 'video-segment-0',
      timelineStart: 0,
      timelineEnd: duration,
      sourceStart: 0,
      sourceEnd: duration,
      videoEnabled: true,
      audioEnabled: true,
    },
  ];
}

export function isMediaTrackEnabled(segment: MediaSegment, track: MediaTrack): boolean {
  if (track === 'video') {
    return segment.videoEnabled !== false;
  }

  return segment.audioEnabled !== false;
}

export function setMediaTrackEnabled(
  segment: MediaSegment,
  track: MediaTrack,
  enabled: boolean,
): MediaSegment {
  if (track === 'video') {
    return { ...segment, videoEnabled: enabled };
  }

  return { ...segment, audioEnabled: enabled };
}

export function getEffectiveTransition(segment: MediaSegment): ClipTransition {
  const t = segment.transitionIn ?? NO_CLIP_TRANSITION;
  if ((t.type as string) === 'fade-black') {
    return { ...t, type: 'fade' };
  }
  return t;
}

export function getEffectiveTransitionOut(segment: MediaSegment): ClipTransition {
  const t = segment.transitionOut ?? { type: 'none', duration: 0.35 };
  if ((t.type as string) === 'fade-black') {
    return { ...t, type: 'fade' };
  }
  return t;
}

/**
 * Returns the initial playback time for a session, offset past any intro on
 * the first clip so the preview doesn't open on a faded-out or tilted frame.
 */
export function getInitialPlaybackTime(
  segments: MediaSegment[],
  motionClips: readonly MotionClip[] = [],
): number {
  const first = sortMediaSegments(segments)[0];
  if (!first) {
    return 0;
  }
  const intro = layoutMotionClips(motionClips, segments).find(
    (c) => getMotionGroup(c) === 'start' && Math.abs(c.start - first.timelineStart) < 0.001,
  );
  return intro ? intro.end + 0.1 : first.timelineStart;
}

export function sortMediaSegments(segments: MediaSegment[]): MediaSegment[] {
  return [...segments].sort((a, b) => a.timelineStart - b.timelineStart);
}

export function findSegmentAtTime(segments: MediaSegment[], time: number): MediaSegment | null {
  if (segments.length === 0) {
    return null;
  }

  const ordered = sortMediaSegments(segments);
  for (let i = 0; i < ordered.length; i += 1) {
    const seg = ordered[i];
    const isLast = i === ordered.length - 1;
    if (
      time >= seg.timelineStart &&
      (time < seg.timelineEnd || (isLast && time <= seg.timelineEnd))
    ) {
      return seg;
    }
  }
  return null;
}

export function findSegmentAtSourceTime(
  segments: MediaSegment[],
  sourceTime: number,
): MediaSegment | null {
  for (const seg of segments) {
    if (seg.videoEnabled === false) {
      continue;
    }
    if (sourceTime >= seg.sourceStart && sourceTime <= seg.sourceEnd + 0.0001) {
      return seg;
    }
  }
  return null;
}

export function mapTimelineTimeToSource(
  segments: MediaSegment[],
  timelineTime: number,
): number | null {
  const seg = findSegmentAtTime(segments, timelineTime);
  if (!seg) {
    return null;
  }
  return seg.sourceStart + (timelineTime - seg.timelineStart) * (seg.speed ?? 1);
}

export function mapSourceTimeToTimelineTime(
  segments: MediaSegment[],
  sourceTime: number,
): number | null {
  const ordered = sortMediaSegments(segments);
  for (const seg of ordered) {
    if (seg.videoEnabled === false) {
      continue;
    }
    const atEnd = Math.abs(sourceTime - seg.sourceEnd) <= 0.0001;
    if (sourceTime < seg.sourceStart || (sourceTime > seg.sourceEnd && !atEnd)) {
      continue;
    }
    return seg.timelineStart + (sourceTime - seg.sourceStart) / (seg.speed ?? 1);
  }
  return null;
}

export function splitMediaSegmentsAtTime(
  segments: MediaSegment[],
  time: number,
  minDuration = MIN_MEDIA_SEGMENT_DURATION,
): MediaSegment[] {
  const ordered = sortMediaSegments(segments);
  let splitIdx = -1;

  for (let i = 0; i < ordered.length; i += 1) {
    const seg = ordered[i];
    if (time > seg.timelineStart + minDuration && time < seg.timelineEnd - minDuration) {
      splitIdx = i;
      break;
    }
  }

  if (splitIdx === -1) {
    return ordered;
  }

  const seg = ordered[splitIdx];
  const sourceSplit = seg.sourceStart + (time - seg.timelineStart);
  const splitKey = Math.round(time * 1000);

  const left: MediaSegment = {
    id: `${seg.id}-a-${splitKey}`,
    timelineStart: seg.timelineStart,
    timelineEnd: time,
    sourceStart: seg.sourceStart,
    sourceEnd: sourceSplit,
    videoEnabled: seg.videoEnabled,
    audioEnabled: seg.audioEnabled,
    transitionIn: seg.transitionIn,
    transitionOut: { type: 'fade', duration: 0.35 },
    speed: seg.speed,
  };

  const right: MediaSegment = {
    id: `${seg.id}-b-${splitKey}`,
    timelineStart: time,
    timelineEnd: seg.timelineEnd,
    sourceStart: sourceSplit,
    sourceEnd: seg.sourceEnd,
    videoEnabled: seg.videoEnabled,
    audioEnabled: seg.audioEnabled,
    transitionIn: { type: 'fade', duration: 0.35 },
    transitionOut: seg.transitionOut,
    speed: seg.speed,
  };

  return [...ordered.slice(0, splitIdx), left, right, ...ordered.slice(splitIdx + 1)];
}

export function splitZoomClipsAtTime(
  clips: ZoomClip[],
  time: number,
  minDuration = MIN_ZOOM_CLIP_DURATION,
): ZoomClip[] {
  const splitKey = Math.round(time * 1000);
  const result: ZoomClip[] = [];

  for (const clip of clips) {
    const overlaps = time > clip.start + minDuration && time < clip.end - minDuration;
    if (!overlaps) {
      result.push(clip);
      continue;
    }

    result.push({
      ...clip,
      id: `${clip.id}-a-${splitKey}`,
      end: time,
    });
    result.push({
      ...clip,
      id: `${clip.id}-b-${splitKey}`,
      start: time,
    });
  }

  return result;
}

export function splitTextClipsAtTime(
  clips: TextClip[],
  time: number,
  minDuration = MIN_ZOOM_CLIP_DURATION,
): TextClip[] {
  const splitKey = Math.round(time * 1000);
  const result: TextClip[] = [];

  for (const clip of clips) {
    const overlaps = time > clip.start + minDuration && time < clip.end - minDuration;
    if (!overlaps) {
      result.push(clip);
      continue;
    }

    result.push({
      ...clip,
      id: `${clip.id}-a-${splitKey}`,
      end: time,
    });
    result.push({
      ...clip,
      id: `${clip.id}-b-${splitKey}`,
      start: time,
    });
  }

  return result;
}

export function splitMusicClipsAtTime(
  clips: MusicClip[],
  time: number,
  minDuration = MIN_ZOOM_CLIP_DURATION,
): MusicClip[] {
  const splitKey = Math.round(time * 1000);
  const result: MusicClip[] = [];

  for (const clip of clips) {
    const overlaps =
      time > clip.timelineStart + minDuration && time < clip.timelineEnd - minDuration;
    if (!overlaps) {
      result.push(clip);
      continue;
    }

    // How far into the audio file the split point lands (accounting for looping).
    const audioDuration = clip.duration || 1;
    const offsetAtSplit = time - clip.timelineStart;
    const startTimeB = clip.startTime + (offsetAtSplit % audioDuration);

    result.push({
      ...clip,
      id: `${clip.id}-a-${splitKey}`,
      timelineEnd: time,
    });
    result.push({
      ...clip,
      id: `${clip.id}-b-${splitKey}`,
      timelineStart: time,
      startTime: startTimeB,
    });
  }

  return result;
}

export function trimMediaSegmentEdge(
  segments: MediaSegment[],
  segmentId: string,
  edge: 'start' | 'end',
  nextTimelineValue: number,
  sourceDuration: number,
  minDuration = MIN_MEDIA_SEGMENT_DURATION,
): MediaSegment[] {
  const ordered = sortMediaSegments(segments);
  const idx = ordered.findIndex((s) => s.id === segmentId);
  if (idx === -1) {
    return ordered;
  }

  const seg = ordered[idx];
  const prevEnd = idx > 0 ? ordered[idx - 1].timelineEnd : Number.NEGATIVE_INFINITY;
  const nextStart =
    idx < ordered.length - 1 ? ordered[idx + 1].timelineStart : Number.POSITIVE_INFINITY;

  let updated = seg;

  if (edge === 'start') {
    const minFromSource = seg.timelineStart - seg.sourceStart;
    const minStart = Math.max(prevEnd, minFromSource);
    const maxStart = seg.timelineEnd - minDuration;
    const timelineStart = clamp(nextTimelineValue, minStart, maxStart);
    const delta = timelineStart - seg.timelineStart;

    updated = {
      ...seg,
      timelineStart,
      sourceStart: seg.sourceStart + delta,
    };
  } else {
    const maxFromSource = seg.timelineEnd + (sourceDuration - seg.sourceEnd);
    const minEnd = seg.timelineStart + minDuration;
    const maxEnd = Math.min(nextStart, maxFromSource);
    const timelineEnd = clamp(nextTimelineValue, minEnd, maxEnd);
    const delta = timelineEnd - seg.timelineEnd;

    updated = {
      ...seg,
      timelineEnd,
      sourceEnd: seg.sourceEnd + delta,
    };
  }

  return [...ordered.slice(0, idx), updated, ...ordered.slice(idx + 1)];
}

export function moveMediaSegment(
  segments: MediaSegment[],
  segmentId: string,
  nextStart: number,
): MediaSegment[] {
  const ordered = sortMediaSegments(segments);
  const idx = ordered.findIndex((s) => s.id === segmentId);
  if (idx === -1) {
    return ordered;
  }

  const seg = ordered[idx];
  const segDuration = seg.timelineEnd - seg.timelineStart;
  const timelineStart = Math.max(0, nextStart);

  if (Math.abs(timelineStart - seg.timelineStart) < Number.EPSILON) {
    return ordered;
  }

  const updated: MediaSegment = {
    ...seg,
    timelineStart,
    timelineEnd: timelineStart + segDuration,
  };

  return [...ordered.slice(0, idx), updated, ...ordered.slice(idx + 1)];
}

/**
 * Ripple-deletes a set of segments: removes them and shifts all subsequent segments
 * left to close the gaps. Zoom clips that overlap a deleted range are removed;
 * clips that start after a deleted range are shifted left by the deleted duration.
 *
 * Returns the updated segments, zoom clips, and the deleted timeline ranges so the
 * caller can adjust other time-based state (e.g. currentTime).
 */
export function applyRippleDelete(
  segments: MediaSegment[],
  zoomClips: ZoomClip[],
  deletedIds: Set<string>,
): {
  segments: MediaSegment[];
  zoomClips: ZoomClip[];
  deletedRanges: Array<{ start: number; end: number }>;
} {
  const ordered = sortMediaSegments(segments);

  const deletedRanges = ordered
    .filter((s) => deletedIds.has(s.id))
    .map((s) => ({ start: s.timelineStart, end: s.timelineEnd }));

  if (deletedRanges.length === 0) {
    return { segments, zoomClips, deletedRanges: [] };
  }

  const getShiftForTime = (time: number): number =>
    deletedRanges.reduce((acc, r) => (r.end <= time ? acc + (r.end - r.start) : acc), 0);

  const remaining = ordered
    .filter((s) => !deletedIds.has(s.id))
    .map((seg) => {
      const shift = getShiftForTime(seg.timelineStart);
      return shift > 0
        ? { ...seg, timelineStart: seg.timelineStart - shift, timelineEnd: seg.timelineEnd - shift }
        : seg;
    });

  // Trim clips against each deleted range instead of removing them entirely.
  // A clip spanning the boundary of a deleted segment survives as a shorter
  // clip (preserving the easeOut/easeIn at the segment edges).
  const rippleZoomClips: ZoomClip[] = [];
  for (const c of zoomClips) {
    let parts: ZoomClip[] = [c];
    for (const r of deletedRanges) {
      const trimmed: ZoomClip[] = [];
      for (const part of parts) {
        if (part.end <= r.start || part.start >= r.end) {
          trimmed.push(part);
        } else {
          if (part.start < r.start) {
            trimmed.push({ ...part, end: r.start });
          }
          if (part.end > r.end) {
            trimmed.push({ ...part, start: r.end });
          }
        }
      }
      parts = trimmed;
    }
    const needsNewId = parts.length !== 1 || parts[0].start !== c.start || parts[0].end !== c.end;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.end - part.start < MIN_ZOOM_CLIP_DURATION) {
        continue;
      }
      const shift = getShiftForTime(part.start);
      const shifted: ZoomClip =
        shift > 0 ? { ...part, start: part.start - shift, end: part.end - shift } : part;
      rippleZoomClips.push({ ...shifted, id: needsNewId ? `${c.id}-t${i}` : c.id });
    }
  }

  return { segments: remaining, zoomClips: rippleZoomClips, deletedRanges };
}

export function mediaSegmentsToActions(segments: MediaSegment[]): TimelineAction[] {
  return sortMediaSegments(segments).map((seg) => ({
    id: seg.id,
    start: seg.timelineStart,
    end: seg.timelineEnd,
    effectId: 'video',
    flexible: true,
    movable: true,
  }));
}

export const MIN_CAMERA_CLIP_DURATION = 0.1;

export function splitMaskClipsAtTime(clips: MaskClip[], time: number): MaskClip[] {
  const splitKey = Math.round(time * 1000);
  const result: MaskClip[] = [];
  for (const clip of clips) {
    const overlaps = time > clip.start + 0.05 && time < clip.end - 0.05;
    if (!overlaps) {
      result.push(clip);
      continue;
    }
    result.push(
      { ...clip, id: `${clip.id}-a-${splitKey}`, end: time },
      { ...clip, id: `${clip.id}-b-${splitKey}`, start: time },
    );
  }
  return result;
}

export function splitCameraClipsAtTime(
  clips: CameraClip[],
  time: number,
  minDuration = MIN_CAMERA_CLIP_DURATION,
): CameraClip[] {
  const splitKey = Math.round(time * 1000);
  const result: CameraClip[] = [];

  for (const clip of clips) {
    const overlaps = time > clip.start + minDuration && time < clip.end - minDuration;
    if (!overlaps) {
      result.push(clip);
      continue;
    }
    result.push(
      { ...clip, id: `${clip.id}-a-${splitKey}`, end: time },
      { ...clip, id: `${clip.id}-b-${splitKey}`, start: time },
    );
  }

  return result;
}

export function findCameraClipAtTime(clips: CameraClip[], time: number): CameraClip | null {
  for (const clip of clips) {
    if (time >= clip.start && time < clip.end) {
      return clip;
    }
  }
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const last = sorted[sorted.length - 1];
  if (last && Math.abs(time - last.end) < 0.001) {
    return last;
  }
  return null;
}

// ── Cutting time ranges out of the timeline (ripple cut) ─────────────────────

/** A span of timeline (or source) time, in seconds. */
export interface TimeRange {
  start: number;
  end: number;
}

const CUT_EPSILON = 1e-6;

/** Sorts ranges, drops empty ones and merges any that overlap or sit within `joinGap`. */
export function normalizeTimeRanges(ranges: readonly TimeRange[], joinGap = 0): TimeRange[] {
  const sorted = ranges
    .filter((r) => r.end - r.start > CUT_EPSILON)
    .map((r) => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start - last.end <= joinGap + CUT_EPSILON) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push(r);
    }
  }
  return merged;
}

/** Total length of a set of ranges, counting overlaps once. */
export function sumTimeRanges(ranges: readonly TimeRange[]): number {
  return normalizeTimeRanges(ranges).reduce((sum, r) => sum + (r.end - r.start), 0);
}

/**
 * Fits timeline cut ranges to the clips on the timeline: keeps only the parts that
 * cover media, and widens a cut so it never leaves a sliver shorter than
 * `minDuration` at a clip edge or between two cuts.
 */
export function resolveTimelineCuts(
  segments: MediaSegment[],
  ranges: readonly TimeRange[],
  minDuration = MIN_MEDIA_SEGMENT_DURATION,
): TimeRange[] {
  const joined = normalizeTimeRanges(ranges, minDuration);
  const pieces: TimeRange[] = [];
  for (const seg of sortMediaSegments(segments)) {
    for (const r of joined) {
      let start = Math.max(r.start, seg.timelineStart);
      let end = Math.min(r.end, seg.timelineEnd);
      if (end - start <= CUT_EPSILON) {
        continue;
      }
      if (start - seg.timelineStart < minDuration) {
        start = seg.timelineStart;
      }
      if (seg.timelineEnd - end < minDuration) {
        end = seg.timelineEnd;
      }
      pieces.push({ start, end });
    }
  }
  return normalizeTimeRanges(pieces);
}

/**
 * Moves a timeline time left by the length of the cuts before it. A time inside a
 * cut lands where the cut was.
 */
export function collapseTimeOverRanges(time: number, ranges: readonly TimeRange[]): number {
  return ranges.reduce((t, r) => t - Math.max(0, Math.min(time, r.end) - r.start), time);
}

/**
 * Closes clips (zoom, mask, camera layout…) up over cut ranges: a clip a cut runs
 * through gets shorter rather than split in two, and a clip left shorter than
 * `minDuration` is dropped.
 */
export function collapseClipsOverRanges<T extends { start: number; end: number }>(
  clips: readonly T[],
  ranges: readonly TimeRange[],
  minDuration: number,
): T[] {
  const result: T[] = [];
  for (const clip of clips) {
    const start = collapseTimeOverRanges(clip.start, ranges);
    const end = collapseTimeOverRanges(clip.end, ranges);
    if (end - start < minDuration) {
      continue;
    }
    result.push(start === clip.start && end === clip.end ? clip : { ...clip, start, end });
  }
  return result;
}

/**
 * Removes timeline ranges from a media track and closes up the gaps. Clips a range
 * runs through are split into the pieces that remain (mapped through their speed);
 * every clip moves left by the length of all ranges before it, whether or not this
 * track covered them, so a second track (the camera) stays in sync with the first.
 *
 * `replaced` maps the id of each clip that changed to the ids of its remaining
 * pieces, in order (empty when the clip was cut away entirely).
 */
export function cutMediaSegmentRanges(
  segments: MediaSegment[],
  ranges: readonly TimeRange[],
): { segments: MediaSegment[]; replaced: Map<string, string[]> } {
  const cuts = normalizeTimeRanges(ranges);
  const replaced = new Map<string, string[]>();
  const result: MediaSegment[] = [];

  for (const seg of sortMediaSegments(segments)) {
    const overlapping = cuts.filter(
      (r) => r.end > seg.timelineStart + CUT_EPSILON && r.start < seg.timelineEnd - CUT_EPSILON,
    );
    if (overlapping.length === 0) {
      const shift = seg.timelineStart - collapseTimeOverRanges(seg.timelineStart, cuts);
      result.push(
        shift > CUT_EPSILON
          ? {
              ...seg,
              timelineStart: seg.timelineStart - shift,
              timelineEnd: seg.timelineEnd - shift,
            }
          : seg,
      );
      continue;
    }

    const kept: TimeRange[] = [];
    let cursor = seg.timelineStart;
    for (const r of overlapping) {
      if (r.start > cursor + CUT_EPSILON) {
        kept.push({ start: cursor, end: r.start });
      }
      cursor = Math.max(cursor, r.end);
    }
    if (cursor < seg.timelineEnd - CUT_EPSILON) {
      kept.push({ start: cursor, end: seg.timelineEnd });
    }

    const speed = seg.speed ?? 1;
    const ids: string[] = [];
    kept.forEach((piece, i) => {
      const id = `${seg.id}-k${i}`;
      ids.push(id);
      const timelineStart = collapseTimeOverRanges(piece.start, cuts);
      const atStart = Math.abs(piece.start - seg.timelineStart) <= CUT_EPSILON;
      const atEnd = Math.abs(piece.end - seg.timelineEnd) <= CUT_EPSILON;
      result.push({
        ...seg,
        id,
        timelineStart,
        timelineEnd: timelineStart + (piece.end - piece.start),
        sourceStart: seg.sourceStart + (piece.start - seg.timelineStart) * speed,
        sourceEnd: seg.sourceStart + (piece.end - seg.timelineStart) * speed,
        transitionIn: atStart ? seg.transitionIn : { ...NO_CLIP_TRANSITION },
        transitionOut: atEnd ? seg.transitionOut : { ...NO_CLIP_TRANSITION },
      });
    });
    replaced.set(seg.id, ids);
  }

  return { segments: result, replaced };
}

/** The parts of the editor state a timeline cut moves. */
export interface TimelineCutState {
  mediaSegments: MediaSegment[];
  cameraMediaSegments: MediaSegment[];
  zoomClips: ZoomClip[];
  cameraClips: CameraClip[];
  maskClips: MaskClip[];
  motionClips: MotionClip[];
}

/**
 * Cuts timeline ranges out of the video and closes up everything that follows: the
 * video and camera tracks, zoom, camera-layout and mask clips, and Motion blocks
 * (a clip's intro stays on its first remaining piece, its outro on its last).
 * Returns null when no media would be cut. `cutRanges` are the ranges actually
 * removed, in timeline time before the cut.
 */
export function applyTimelineCuts(
  state: TimelineCutState,
  ranges: readonly TimeRange[],
): (TimelineCutState & { cutRanges: TimeRange[] }) | null {
  const cutRanges = resolveTimelineCuts(state.mediaSegments, ranges);
  if (cutRanges.length === 0) {
    return null;
  }

  const main = cutMediaSegmentRanges(state.mediaSegments, cutRanges);
  const camera = cutMediaSegmentRanges(state.cameraMediaSegments, cutRanges);

  const removedIds = new Set<string>();
  for (const [id, kept] of main.replaced) {
    if (kept.length === 0) {
      removedIds.add(id);
    }
  }
  const repinned = state.motionClips.map((clip) => {
    const kept = clip.clipId ? main.replaced.get(clip.clipId) : undefined;
    if (!kept || kept.length === 0) {
      return clip;
    }
    const clipId = getMotionGroup(clip) === 'end' ? kept[kept.length - 1] : kept[0];
    return { ...clip, clipId };
  });

  return {
    mediaSegments: main.segments,
    cameraMediaSegments: camera.segments,
    zoomClips: collapseClipsOverRanges(state.zoomClips, cutRanges, MIN_ZOOM_CLIP_DURATION),
    cameraClips: collapseClipsOverRanges(state.cameraClips, cutRanges, MIN_CAMERA_CLIP_DURATION),
    maskClips: collapseClipsOverRanges(state.maskClips, cutRanges, MIN_ZOOM_CLIP_DURATION),
    motionClips: rippleMotionClips(repinned, removedIds, cutRanges),
    cutRanges,
  };
}
