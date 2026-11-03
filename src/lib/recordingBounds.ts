import type { RecordingArea, RecordingBoundsSample } from '../types/index';

type BoundsLike = RecordingArea & { scaleFactor?: number };

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getPointOverflowScore(x: number, y: number, area: RecordingArea): number {
  const leftOverflow = Math.max(area.x - x, 0);
  const rightOverflow = Math.max(x - (area.x + area.width), 0);
  const topOverflow = Math.max(area.y - y, 0);
  const bottomOverflow = Math.max(y - (area.y + area.height), 0);
  return leftOverflow + rightOverflow + topOverflow + bottomOverflow;
}

export function getRecordingBoundsAtTimestamp(
  recordingArea: RecordingArea,
  boundsTimeline: RecordingBoundsSample[] | undefined,
  timestamp: number,
): BoundsLike {
  if (!boundsTimeline || boundsTimeline.length === 0) {
    return recordingArea;
  }

  let selected = boundsTimeline[0];
  for (const sample of boundsTimeline) {
    if (sample.timestamp > timestamp) {
      break;
    }
    selected = sample;
  }

  return selected;
}

export function normalizeCursorPointForRecordingBounds(
  x: number,
  y: number,
  area: BoundsLike,
): { x: number; y: number } {
  const logicalPoint = { x, y };
  const scaleFactor = area.scaleFactor && area.scaleFactor > 0 ? area.scaleFactor : 1;

  if (scaleFactor === 1) {
    return logicalPoint;
  }

  const scaledPoint = {
    x: x / scaleFactor,
    y: y / scaleFactor,
  };

  return getPointOverflowScore(scaledPoint.x, scaledPoint.y, area) <
    getPointOverflowScore(logicalPoint.x, logicalPoint.y, area)
    ? scaledPoint
    : logicalPoint;
}

export function normalizeCursorEventToRecordingBounds(
  x: number,
  y: number,
  recordingArea: RecordingArea,
  boundsTimeline: RecordingBoundsSample[] | undefined,
  timestamp: number,
): { nx: number; ny: number } {
  const bounds = getRecordingBoundsAtTimestamp(recordingArea, boundsTimeline, timestamp);
  const point = normalizeCursorPointForRecordingBounds(x, y, bounds);

  return {
    nx: clamp01((point.x - bounds.x) / Math.max(bounds.width, 1)),
    ny: clamp01((point.y - bounds.y) / Math.max(bounds.height, 1)),
  };
}
