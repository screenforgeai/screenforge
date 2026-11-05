import type { TimelineAction } from '@xzdarcy/timeline-engine';
import type {
  CameraClip,
  MaskClip,
  ZoomClip,
  MediaSegment,
  ClipTransition,
} from '../../types/timeline';
import { NO_CLIP_TRANSITION } from '../../types/timeline';
import { getMotionGroup, layoutMotionClips } from '../animation/motionClips';
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
