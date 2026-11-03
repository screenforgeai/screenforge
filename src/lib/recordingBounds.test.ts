import { describe, expect, it } from 'vitest';
import {
  getRecordingBoundsAtTimestamp,
  normalizeCursorEventToRecordingBounds,
} from './recordingBounds';

describe('recordingBounds', () => {
  it('uses the latest bounds sample at or before the event timestamp', () => {
    const fallbackArea = { x: 0, y: 0, width: 100, height: 100 };
    const timeline = [
      { timestamp: 100, x: 10, y: 20, width: 200, height: 100, scaleFactor: 2 },
      { timestamp: 200, x: 20, y: 40, width: 300, height: 150, scaleFactor: 2 },
    ];

    expect(getRecordingBoundsAtTimestamp(fallbackArea, timeline, 150)).toEqual(timeline[0]);
    expect(getRecordingBoundsAtTimestamp(fallbackArea, timeline, 250)).toEqual(timeline[1]);
    expect(getRecordingBoundsAtTimestamp(fallbackArea, timeline, 50)).toEqual(timeline[0]);
  });

  it('normalizes scaled cursor coordinates against the matching bounds sample', () => {
    const recordingArea = { x: 10, y: 20, width: 200, height: 100 };
    const boundsTimeline = [
      { timestamp: 1000, x: 10, y: 20, width: 200, height: 100, scaleFactor: 2 },
    ];

    const point = normalizeCursorEventToRecordingBounds(
      220,
      140,
      recordingArea,
      boundsTimeline,
      1100,
    );

    expect(point.nx).toBeCloseTo(0.5);
    expect(point.ny).toBeCloseTo(0.5);
  });
});
