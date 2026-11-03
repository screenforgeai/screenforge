import type {
  CursorEvent,
  CursorType,
  RecordingArea,
  RecordingBoundsSample,
} from '../../../types/index';
import type { MediaSegment } from '../../../types/timeline';
import type { MediaTrack } from '../../helpers/segments';
import { isMediaTrackEnabled, sortMediaSegments } from '../../helpers/segments';
import { normalizeCursorEventToRecordingBounds } from '../../recordingBounds';

export interface MoveEvent {
  t: number; // seconds from recording start
  nx: number; // 0–1 relative to recording area
  ny: number;
  cursorType: CursorType;
}

export interface ClickEvent {
  t: number;
  nx: number;
  ny: number;
  button?: string | number;
}

export interface PressEvent {
  t: number;
  isDown: boolean;
}

export interface ActivityEvent {
  t: number;
}

export interface CursorData {
  moveEvents: MoveEvent[];
  clickEvents: ClickEvent[];
  pressEvents: PressEvent[];
  activityEvents: ActivityEvent[];
}

/**
 * Sliding-window median over raw move events.
 *
 * A median filter completely eliminates single- or double-sample spikes
 * (e.g. Y-flipped coordinates emitted by the native helper at DOM element
 * boundaries) while preserving smooth cursor motion unchanged — unlike a
 * mean filter, which only dilutes spikes rather than removing them.
 *
 * Window of 5 samples at typical 60Hz input = ~83ms, same lag as before.
 */
function smoothPath(events: MoveEvent[]): MoveEvent[] {
  const HALF = 2; // window radius: 2*HALF+1 = 5 samples
  return events.map((e, i) => {
    const nxs: number[] = [];
    const nys: number[] = [];
    for (let j = Math.max(0, i - HALF); j <= Math.min(events.length - 1, i + HALF); j++) {
      nxs.push(events[j].nx);
      nys.push(events[j].ny);
    }
    nxs.sort((a, b) => a - b);
    nys.sort((a, b) => a - b);
    const mid = nxs.length >> 1;
    return { ...e, nx: nxs[mid], ny: nys[mid] };
  });
}

export const getMoveEvents = (
  events: CursorEvent[],
  startTime: number,
  area: RecordingArea,
  boundsTimeline?: RecordingBoundsSample[],
): MoveEvent[] => {
  const raw = events
    .filter((e) => e.type === 'move' && e.x !== undefined && e.y !== undefined)
    .map((e) => {
      const point = normalizeCursorEventToRecordingBounds(
        e.x ?? 0,
        e.y ?? 0,
        area,
        boundsTimeline,
        e.timestamp,
      );

      return {
        t: (e.timestamp - startTime) / 1000,
        nx: point.nx,
        ny: point.ny,
        cursorType: e.cursorType ?? 'default',
      };
    });

  return smoothPath(raw);
};

export const getClickEvents = (
  events: CursorEvent[],
  startTime: number,
  area: RecordingArea,
  boundsTimeline?: RecordingBoundsSample[],
): ClickEvent[] =>
  events
    .filter((e) => e.type === 'mousedown' && e.x !== undefined && e.y !== undefined)
    .map((e) => {
      const point = normalizeCursorEventToRecordingBounds(
        e.x ?? 0,
        e.y ?? 0,
        area,
        boundsTimeline,
        e.timestamp,
      );

      return {
        t: (e.timestamp - startTime) / 1000,
        nx: point.nx,
        ny: point.ny,
        button: e.button,
      };
    });

export const getPressEvents = (events: CursorEvent[], startTime: number): PressEvent[] =>
  events
    .filter((e) => e.type === 'mousedown' || e.type === 'mouseup')
    .map((e) => ({
      t: (e.timestamp - startTime) / 1000,
      isDown: e.type === 'mousedown',
    }));

export const getActivityEvents = (events: CursorEvent[], startTime: number): ActivityEvent[] => {
  // Moves must travel ≥ 8 px from the last accepted position to count as activity.
  // This prevents hardware/OS jitter from waking a hidden cursor.
  const MOVE_THRESHOLD_SQ = 64;
  let refX: number | null = null;
  let refY: number | null = null;

  const result: ActivityEvent[] = [];
  for (const e of events) {
    if (e.type === 'move') {
      if (e.x === undefined || e.y === undefined) {
        continue;
      }
      if (refX !== null && refY !== null) {
        const dx = e.x - refX;
        const dy = e.y - refY;
        if (dx * dx + dy * dy < MOVE_THRESHOLD_SQ) {
          continue;
        }
      }
      refX = e.x;
      refY = e.y;
      result.push({ t: (e.timestamp - startTime) / 1000 });
    } else if (
      e.type === 'mousedown' ||
      e.type === 'mouseup' ||
      e.type === 'scroll' ||
      e.type === 'keydown' ||
      e.type === 'keyup'
    ) {
      result.push({ t: (e.timestamp - startTime) / 1000 });
    }
  }
  return result;
};

type TimedEvent = {
  t: number;
};

function mapSourceTimeToTimelineTime(
  segments: MediaSegment[],
  sourceTime: number,
  track: MediaTrack,
): number | null {
  for (const segment of segments) {
    if (!isMediaTrackEnabled(segment, track)) {
      continue;
    }

    const startsBeforeEnd = sourceTime < segment.sourceEnd;
    const matchesTrailingEdge = Math.abs(sourceTime - segment.sourceEnd) <= 0.0001;
    if (sourceTime < segment.sourceStart || (!startsBeforeEnd && !matchesTrailingEdge)) {
      continue;
    }

    return segment.timelineStart + (sourceTime - segment.sourceStart) / (segment.speed ?? 1);
  }

  return null;
}

function mapTimedEventsToTimeline<T extends TimedEvent>(
  events: T[],
  segments: MediaSegment[],
  track: MediaTrack,
): T[] {
  // Filter out events that fall in deleted/non-playable source ranges, but keep
  // their original source-time t values. The cursor renderer always looks up by
  // source time (t = frameSourceTime in export, video.currentTime in preview),
  // so remapping to timeline time would misalign lookups for speed-changed clips.
  return events.filter((event) => mapSourceTimeToTimelineTime(segments, event.t, track) !== null);
}

export function mapCursorDataToTimeline(
  data: CursorData,
  segments: MediaSegment[],
  track: MediaTrack = 'video',
): CursorData {
  const orderedSegments = sortMediaSegments(segments);
  if (orderedSegments.length === 0) {
    return {
      moveEvents: [],
      clickEvents: [],
      pressEvents: [],
      activityEvents: [],
    };
  }

  return {
    moveEvents: mapTimedEventsToTimeline(data.moveEvents, orderedSegments, track),
    clickEvents: mapTimedEventsToTimeline(data.clickEvents, orderedSegments, track),
    pressEvents: mapTimedEventsToTimeline(data.pressEvents, orderedSegments, track),
    activityEvents: mapTimedEventsToTimeline(data.activityEvents, orderedSegments, track),
  };
}
