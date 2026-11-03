export interface RecordingPauseSpan {
  startTime: number;
  endTime: number | null;
}

type TimestampedEntry = {
  timestamp: number;
};

function clampPauseSpanStart(startTime: number, recordingStartTime: number): number {
  return Math.max(recordingStartTime, startTime);
}

export function finalizePauseSpans(
  spans: readonly RecordingPauseSpan[],
  stopTime: number,
): RecordingPauseSpan[] {
  return spans
    .map((span) => ({
      startTime: span.startTime,
      endTime: span.endTime ?? stopTime,
    }))
    .filter((span) => span.endTime > span.startTime);
}

export function getPausedDurationBefore(
  timestamp: number,
  recordingStartTime: number,
  spans: readonly RecordingPauseSpan[],
): number {
  const clampedTimestamp = Math.max(timestamp, recordingStartTime);
  let pausedDurationMs = 0;

  for (const span of spans) {
    const spanStart = clampPauseSpanStart(span.startTime, recordingStartTime);
    const spanEnd = Math.max(spanStart, span.endTime ?? clampedTimestamp);

    if (clampedTimestamp <= spanStart) {
      continue;
    }

    pausedDurationMs += Math.max(0, Math.min(clampedTimestamp, spanEnd) - spanStart);
  }

  return pausedDurationMs;
}

export function normalizeRecordingTimestamp(
  timestamp: number,
  recordingStartTime: number,
  spans: readonly RecordingPauseSpan[],
): number {
  return (
    recordingStartTime +
    Math.max(
      0,
      timestamp -
        recordingStartTime -
        getPausedDurationBefore(timestamp, recordingStartTime, spans),
    )
  );
}

export function normalizeTimestampedEntries<T extends TimestampedEntry>(
  entries: readonly T[],
  recordingStartTime: number,
  spans: readonly RecordingPauseSpan[],
): T[] {
  return entries.map((entry) => ({
    ...entry,
    timestamp: normalizeRecordingTimestamp(entry.timestamp, recordingStartTime, spans),
  }));
}

export function computeActiveDurationMs(
  recordingStartTime: number,
  stopTime: number,
  spans: readonly RecordingPauseSpan[],
): number {
  return Math.max(
    0,
    stopTime - recordingStartTime - getPausedDurationBefore(stopTime, recordingStartTime, spans),
  );
}

export function computeActiveStopTime(
  recordingStartTime: number,
  stopTime: number,
  spans: readonly RecordingPauseSpan[],
): number {
  return recordingStartTime + computeActiveDurationMs(recordingStartTime, stopTime, spans);
}
