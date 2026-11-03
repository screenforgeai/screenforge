/**
 * Builds an FFmpeg delogo filtergraph that follows the cursor path.
 *
 * Each cursor event defines the erase box position for the time window
 * between it and the next event. Events are downsampled to reduce
 * filtergraph size without visible quality loss.
 */
import type {
  CursorEvent,
  RecordingArea,
  RecordingBoundsSample,
} from '../../../../src/types/index';
import {
  getRecordingBoundsAtTimestamp,
  normalizeCursorPointForRecordingBounds,
} from '../../../../src/lib/recordingBounds';

interface DelogoOptions {
  /** Cursor events from uiohook, with absolute timestamps (Date.now() ms) */
  events: CursorEvent[];
  /** Date.now() ms when recording started — used to compute relative times */
  startTime: number;
  /** Bounds of the captured display in logical pixels */
  recordingArea: RecordingArea;
  /** Actual video pixel dimensions (may differ from logical due to DPI) */
  videoWidth: number;
  videoHeight: number;
  /** Optional live bounds timeline for moving/resizing window capture */
  boundsTimeline?: RecordingBoundsSample[];
  /**
   * Minimum time gap between sampled events in ms.
   * Lower = more accurate but larger filtergraph. Default: 50ms.
   */
  sampleIntervalMs?: number;
  /**
   * Erase box size in video pixels.
   * Should cover the largest cursor shape used. Default: 48x52.
   */
  boxWidth?: number;
  boxHeight?: number;
}

interface DelogoSegment {
  t0: number; // seconds
  t1: number; // seconds
  x: number; // top-left in video pixels
  y: number;
}

function hasCursorCoordinates(
  event: CursorEvent,
): event is CursorEvent & Required<Pick<CursorEvent, 'x' | 'y'>> {
  return event.type === 'move' && event.x != null && event.y != null;
}

/**
 * Returns a chained delogo filtergraph string, or null if there are no
 * usable move events (e.g. recording with no mouse movement).
 */
export function buildDelogoFilter(opts: DelogoOptions): string | null {
  const {
    events,
    startTime,
    recordingArea,
    videoWidth,
    videoHeight,
    boundsTimeline,
    sampleIntervalMs = 50,
    boxWidth = 48,
    boxHeight = 52,
  } = opts;

  // Only use move events that have coordinates
  const moves = events.filter(hasCursorCoordinates);
  if (moves.length === 0) {
    return null;
  }

  // Downsample: keep one event per sampleIntervalMs bucket
  const sampled: CursorEvent[] = [];
  let lastKept = -Infinity;
  for (const e of moves) {
    if (e.timestamp - lastKept >= sampleIntervalMs) {
      sampled.push(e);
      lastKept = e.timestamp;
    }
  }

  // Build segments
  const segments: DelogoSegment[] = [];
  for (let i = 0; i < sampled.length; i++) {
    const e = sampled[i];
    const next = sampled[i + 1];

    const t0 = Math.max(0, (e.timestamp - startTime) / 1000);
    // Extend last segment to end of video; use next event time otherwise
    const t1 = next ? (next.timestamp - startTime) / 1000 : t0 + 9999;

    // Convert logical coords to video pixel coords
    const bounds = getRecordingBoundsAtTimestamp(recordingArea, boundsTimeline, e.timestamp);
    const normalizedPoint = normalizeCursorPointForRecordingBounds(e.x, e.y, bounds);
    const scaleX = videoWidth / Math.max(bounds.width, 1);
    const scaleY = videoHeight / Math.max(bounds.height, 1);
    const lx = (normalizedPoint.x - bounds.x) * scaleX;
    const ly = (normalizedPoint.y - bounds.y) * scaleY;

    // Arrow cursor hotspot is top-left — box starts at cursor tip
    const x = Math.max(0, Math.round(lx));
    const y = Math.max(0, Math.round(ly));

    segments.push({ t0, t1, x, y });
  }

  if (segments.length === 0) {
    return null;
  }

  // Build chained filter string
  // Each delogo is enabled only during its time window
  const parts = segments.map(
    ({ t0, t1, x, y }) =>
      `delogo=x=${x}:y=${y}:w=${boxWidth}:h=${boxHeight}:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'`,
  );

  return parts.join(',');
}
