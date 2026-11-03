import type { MediaSegment } from '../../types/timeline';
import { findSegmentAtTime, isMediaTrackEnabled } from '../helpers/segments';

export const VIDEO_DECODE_STALL_ERROR = 'Video decode stalled during export';

export function isCaptureKeyFrame(frameIndex: number, fps: number): boolean {
  return frameIndex % Math.max(1, Math.round(fps)) === 0;
}

export function resolveOutputFrameMode(activeSegment: MediaSegment | null): 'video' | 'black' {
  return activeSegment && isMediaTrackEnabled(activeSegment, 'video') ? 'video' : 'black';
}

export function getSegmentIndexAtTime(segments: MediaSegment[], timelineTime: number): number {
  const segment = findSegmentAtTime(segments, timelineTime);
  return segment ? segments.indexOf(segment) : -1;
}

export function shouldSeekAtSegmentBoundary(
  lastSegmentIndex: number,
  nextSegmentIndex: number,
): boolean {
  return (
    nextSegmentIndex !== -1 && nextSegmentIndex !== lastSegmentIndex && lastSegmentIndex !== -1
  );
}

export function getSyntheticEndMediaTime(totalDuration: number, fps: number): number {
  return totalDuration + 1 / Math.max(fps, 1);
}

export function clampMediaSegmentsToSourceDuration(
  segments: MediaSegment[],
  sourceDuration: number,
  minDuration = 1 / 240,
): MediaSegment[] {
  const clampedSourceDuration = Math.max(0, sourceDuration);

  return segments.flatMap((segment) => {
    const speed = segment.speed ?? 1;
    const sourceStart = Math.max(0, Math.min(segment.sourceStart, clampedSourceDuration));
    const maxPlayableSourceDuration = Math.max(0, clampedSourceDuration - sourceStart);
    // Source duration needed = timeline duration × speed (e.g. 4.75s timeline at 2× = 9.5s source).
    const requestedSourceDuration = Math.max(
      0,
      (segment.timelineEnd - segment.timelineStart) * speed,
    );
    const playableSourceDuration = Math.min(requestedSourceDuration, maxPlayableSourceDuration);
    const playableTimelineDuration = playableSourceDuration / speed;

    if (playableTimelineDuration < minDuration) {
      return [];
    }

    return [
      {
        ...segment,
        sourceStart,
        sourceEnd: sourceStart + playableSourceDuration,
        timelineEnd: segment.timelineStart + playableTimelineDuration,
      },
    ];
  });
}

type StallTimerHost = Pick<typeof globalThis, 'clearTimeout' | 'setTimeout'>;

export interface CaptureStallWatch {
  arm: () => void;
  clear: () => void;
}

export function createCaptureStallWatch(
  timeoutMs: number,
  onTimeout: () => void,
  timers: StallTimerHost = globalThis,
): CaptureStallWatch {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timeoutId !== null) {
      timers.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return {
    arm: () => {
      clear();
      timeoutId = timers.setTimeout(() => {
        timeoutId = null;
        onTimeout();
      }, timeoutMs);
    },
    clear,
  };
}
