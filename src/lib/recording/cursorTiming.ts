import type { CursorEvent } from '../../types';

type TimedEntry = {
  t: number;
};

export interface TimedSeriesSummary {
  count: number;
  firstOffsetMs: number | null;
  lastOffsetMs: number | null;
  firstInRangeOffsetMs: number | null;
  lastInRangeOffsetMs: number | null;
  leadingGapMs: number | null;
  trailingGapMs: number | null;
  maxGapMs: number | null;
  gapCountOver250Ms: number;
  eventsBeforeStartCount: number;
  eventsAfterEndCount: number;
}

export interface CursorEventTimingSummary {
  totalEvents: number;
  durationMs: number | null;
  all: TimedSeriesSummary;
  move: TimedSeriesSummary;
  click: TimedSeriesSummary;
  press: TimedSeriesSummary;
  scroll: TimedSeriesSummary;
  keyboard: TimedSeriesSummary;
}

export interface TimedEntryWindowSummary {
  state: 'empty' | 'before-first' | 'tracking' | 'gap' | 'after-last';
  previousOffsetMs: number | null;
  nextOffsetMs: number | null;
  surroundingGapMs: number | null;
}

function summarizeOffsets(
  offsetsMs: readonly number[],
  totalDurationMs?: number,
): TimedSeriesSummary {
  const sortedOffsets = [...offsetsMs].sort((a, b) => a - b);
  const eventsBeforeStartCount = sortedOffsets.filter((offset) => offset < 0).length;
  const eventsAfterEndCount =
    totalDurationMs === undefined
      ? 0
      : sortedOffsets.filter((offset) => offset > totalDurationMs).length;
  const inRangeOffsets = sortedOffsets.filter(
    (offset) => offset >= 0 && (totalDurationMs === undefined || offset <= totalDurationMs),
  );

  let maxGapMs: number | null = null;
  let gapCountOver250Ms = 0;
  for (let i = 1; i < inRangeOffsets.length; i += 1) {
    const gapMs = inRangeOffsets[i] - inRangeOffsets[i - 1];
    maxGapMs = maxGapMs === null ? gapMs : Math.max(maxGapMs, gapMs);
    if (gapMs > 250) {
      gapCountOver250Ms += 1;
    }
  }

  return {
    count: sortedOffsets.length,
    firstOffsetMs: sortedOffsets[0] ?? null,
    lastOffsetMs: sortedOffsets.at(-1) ?? null,
    firstInRangeOffsetMs: inRangeOffsets[0] ?? null,
    lastInRangeOffsetMs: inRangeOffsets.at(-1) ?? null,
    leadingGapMs: inRangeOffsets[0] ?? null,
    trailingGapMs:
      totalDurationMs === undefined || inRangeOffsets.length === 0
        ? null
        : Math.max(0, totalDurationMs - inRangeOffsets[inRangeOffsets.length - 1]),
    maxGapMs,
    gapCountOver250Ms,
    eventsBeforeStartCount,
    eventsAfterEndCount,
  };
}

function summarizeCursorEventType(
  events: readonly CursorEvent[],
  startTimeMs: number,
  stopTimeMs?: number,
): TimedSeriesSummary {
  return summarizeOffsets(
    events.map((event) => event.timestamp - startTimeMs),
    stopTimeMs === undefined ? undefined : Math.max(0, stopTimeMs - startTimeMs),
  );
}

export function summarizeCursorEvents(
  events: readonly CursorEvent[],
  startTimeMs: number,
  stopTimeMs?: number,
): CursorEventTimingSummary {
  const clickEvents = events.filter((event) => event.type === 'mousedown');
  const pressEvents = events.filter(
    (event) => event.type === 'mousedown' || event.type === 'mouseup',
  );
  const keyboardEvents = events.filter(
    (event) => event.type === 'keydown' || event.type === 'keyup',
  );

  return {
    totalEvents: events.length,
    durationMs: stopTimeMs === undefined ? null : Math.max(0, stopTimeMs - startTimeMs),
    all: summarizeCursorEventType(events, startTimeMs, stopTimeMs),
    move: summarizeCursorEventType(
      events.filter((event) => event.type === 'move'),
      startTimeMs,
      stopTimeMs,
    ),
    click: summarizeCursorEventType(clickEvents, startTimeMs, stopTimeMs),
    press: summarizeCursorEventType(pressEvents, startTimeMs, stopTimeMs),
    scroll: summarizeCursorEventType(
      events.filter((event) => event.type === 'scroll'),
      startTimeMs,
      stopTimeMs,
    ),
    keyboard: summarizeCursorEventType(keyboardEvents, startTimeMs, stopTimeMs),
  };
}

export function summarizeTimedEntries(
  entries: readonly TimedEntry[],
  totalDurationSeconds?: number,
): TimedSeriesSummary {
  return summarizeOffsets(
    entries.map((entry) => entry.t * 1000),
    totalDurationSeconds === undefined ? undefined : Math.max(0, totalDurationSeconds * 1000),
  );
}

export function describeTimedEntryWindow(
  entries: readonly TimedEntry[],
  timeSeconds: number,
  gapThresholdSeconds = 0.25,
): TimedEntryWindowSummary {
  if (entries.length === 0) {
    return {
      state: 'empty',
      previousOffsetMs: null,
      nextOffsetMs: null,
      surroundingGapMs: null,
    };
  }

  let lo = 0;
  let hi = entries.length - 1;
  let previousIndex = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].t <= timeSeconds) {
      previousIndex = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const previous = previousIndex >= 0 ? entries[previousIndex] : null;
  const next = previousIndex + 1 < entries.length ? entries[previousIndex + 1] : null;
  const previousOffsetMs = previous ? Math.round((timeSeconds - previous.t) * 1000) : null;
  const nextOffsetMs = next ? Math.round((next.t - timeSeconds) * 1000) : null;
  const surroundingGapMs = previous && next ? Math.round((next.t - previous.t) * 1000) : null;

  if (!previous) {
    return {
      state: 'before-first',
      previousOffsetMs,
      nextOffsetMs,
      surroundingGapMs,
    };
  }

  if (!next) {
    return {
      state: 'after-last',
      previousOffsetMs,
      nextOffsetMs,
      surroundingGapMs,
    };
  }

  return {
    state: next.t - previous.t > gapThresholdSeconds ? 'gap' : 'tracking',
    previousOffsetMs,
    nextOffsetMs,
    surroundingGapMs,
  };
}
