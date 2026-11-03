import { describe, expect, it } from 'vitest';
import {
  computeActiveDurationMs,
  computeActiveStopTime,
  finalizePauseSpans,
  getPausedDurationBefore,
  normalizeRecordingTimestamp,
  normalizeTimestampedEntries,
  type RecordingPauseSpan,
} from './timing';

const RECORDING_START = 1_000;

describe('recording timing helpers', () => {
  it('finalizes open pause spans at stop time', () => {
    const spans: RecordingPauseSpan[] = [
      { startTime: 1_500, endTime: null },
      { startTime: 2_500, endTime: 2_700 },
    ];

    expect(finalizePauseSpans(spans, 2_000)).toEqual([
      { startTime: 1_500, endTime: 2_000 },
      { startTime: 2_500, endTime: 2_700 },
    ]);
  });

  it('accumulates paused duration before a timestamp', () => {
    const spans = finalizePauseSpans(
      [
        { startTime: 1_500, endTime: 1_900 },
        { startTime: 2_400, endTime: 2_600 },
      ],
      3_000,
    );

    expect(getPausedDurationBefore(1_400, RECORDING_START, spans)).toBe(0);
    expect(getPausedDurationBefore(1_800, RECORDING_START, spans)).toBe(300);
    expect(getPausedDurationBefore(2_500, RECORDING_START, spans)).toBe(500);
    expect(getPausedDurationBefore(3_000, RECORDING_START, spans)).toBe(600);
  });

  it('normalizes timestamps by removing paused spans', () => {
    const spans = finalizePauseSpans(
      [
        { startTime: 1_500, endTime: 1_900 },
        { startTime: 2_400, endTime: 2_600 },
      ],
      3_000,
    );

    expect(normalizeRecordingTimestamp(1_200, RECORDING_START, spans)).toBe(1_200);
    expect(normalizeRecordingTimestamp(1_800, RECORDING_START, spans)).toBe(1_500);
    expect(normalizeRecordingTimestamp(2_800, RECORDING_START, spans)).toBe(2_200);
  });

  it('normalizes timestamped event series without mutating other fields', () => {
    const spans = finalizePauseSpans([{ startTime: 1_500, endTime: 1_900 }], 2_500);

    const normalized = normalizeTimestampedEntries(
      [
        { timestamp: 1_200, kind: 'move' },
        { timestamp: 2_000, kind: 'click' },
      ],
      RECORDING_START,
      spans,
    );

    expect(normalized).toEqual([
      { timestamp: 1_200, kind: 'move' },
      { timestamp: 1_600, kind: 'click' },
    ]);
  });

  it('computes active stop time and duration from paused spans', () => {
    const spans = finalizePauseSpans(
      [
        { startTime: 1_500, endTime: 1_900 },
        { startTime: 2_100, endTime: 2_400 },
      ],
      3_000,
    );

    expect(computeActiveDurationMs(RECORDING_START, 3_000, spans)).toBe(1_300);
    expect(computeActiveStopTime(RECORDING_START, 3_000, spans)).toBe(2_300);
  });
});
