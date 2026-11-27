import type { MediaSegment } from '../../types/timeline';
import { findSegmentAtTime, isMediaTrackEnabled } from '../helpers/segments';

export const VIDEO_DECODE_STALL_ERROR = 'Video decode stalled during export';

/**
 * Share of wall time a background pre-render spends rendering while someone
 * uses the editor (its preview drawing, or a click, key or scroll a moment
 * ago). 0 holds it, so the editor's frames never wait behind it.
 */
export const PRERENDER_ACTIVE_DUTY_CYCLE = 0;

/**
 * The same while the editor is still (its preview asleep) or hidden: nothing
 * else is drawing, so the pre-render runs flat out. The export test harness,
 * which has no editor, runs at this pace.
 */
export const PRERENDER_IDLE_DUTY_CYCLE = 1;

/**
 * Frames a pre-render renders between rests, which bounds its GPU work queued
 * at once: when someone clicks, the editor's next frame waits behind at most
 * this many of them, and the hold takes effect after them.
 */
export const PRERENDER_FRAMES_PER_BURST = 2;

/**
 * A capture's pace as a share of wall time spent rendering: 1 when unset or
 * invalid, 0 (held) at or below 0, otherwise kept within [0.05, 1].
 */
export function normalizeDutyCycle(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 1;
  }
  return value <= 0 ? 0 : Math.min(1, Math.max(0.05, value));
}

/** How long to rest after `busyMs` of work, so work takes `dutyCycle` of the time. */
export function restAfterWork(busyMs: number, dutyCycle: number): number {
  return dutyCycle > 0 && dutyCycle < 1 ? (busyMs * (1 - dutyCycle)) / dutyCycle : 0;
}

/**
 * Waits while the pace reads 0 (held), checking every `pollMs`, until it goes
 * up or `signal` aborts. Returns the pace to continue at.
 */
export async function waitWhileHeld(
  readDutyCycle: () => number,
  signal?: AbortSignal,
  pollMs = 50,
): Promise<number> {
  let dutyCycle = readDutyCycle();
  while (dutyCycle === 0 && !signal?.aborted) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    dutyCycle = readDutyCycle();
  }
  return dutyCycle;
}

/**
 * Lets other tasks (input, IPC, timers that are due) run, then continues. A
 * message-channel task rather than setTimeout(0), which Chromium delays to 4 ms
 * once timers nest: a pre-render that rests every two frames lost a seventh of
 * its speed to that.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

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
