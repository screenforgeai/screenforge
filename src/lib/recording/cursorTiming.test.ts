import { describe, expect, it } from 'vitest';
import type { CursorEvent } from '../../types';
import {
  describeTimedEntryWindow,
  summarizeCursorEvents,
  summarizeTimedEntries,
} from './cursorTiming';

describe('cursor timing diagnostics', () => {
  it('summarizes cursor event offsets relative to a recording window', () => {
    const startTimeMs = 1_000;
    const stopTimeMs = 2_000;
    const events: CursorEvent[] = [
      { type: 'move', timestamp: 900, x: 0, y: 0 },
      { type: 'move', timestamp: 1_050, x: 10, y: 10 },
      { type: 'mousedown', timestamp: 1_250, x: 10, y: 10, button: 'left' },
      { type: 'mouseup', timestamp: 1_280, x: 10, y: 10, button: 'left' },
      { type: 'move', timestamp: 1_900, x: 20, y: 20 },
      { type: 'scroll', timestamp: 2_050, x: 20, y: 20, deltaY: 1 },
    ];

    const summary = summarizeCursorEvents(events, startTimeMs, stopTimeMs);

    expect(summary.totalEvents).toBe(6);
    expect(summary.durationMs).toBe(1_000);
    expect(summary.all.eventsBeforeStartCount).toBe(1);
    expect(summary.all.eventsAfterEndCount).toBe(1);
    expect(summary.move.firstInRangeOffsetMs).toBe(50);
    expect(summary.move.lastInRangeOffsetMs).toBe(900);
    expect(summary.move.leadingGapMs).toBe(50);
    expect(summary.move.trailingGapMs).toBe(100);
    expect(summary.move.maxGapMs).toBe(850);
    expect(summary.move.gapCountOver250Ms).toBe(1);
    expect(summary.click.count).toBe(1);
    expect(summary.press.count).toBe(2);
    expect(summary.scroll.count).toBe(1);
  });

  it('summarizes analyzed timed entries', () => {
    const summary = summarizeTimedEntries([{ t: 0.02 }, { t: 0.25 }, { t: 0.8 }], 1.0);

    expect(summary.count).toBe(3);
    expect(summary.firstOffsetMs).toBe(20);
    expect(summary.lastOffsetMs).toBe(800);
    expect(summary.leadingGapMs).toBe(20);
    expect(summary.trailingGapMs).toBe(200);
    expect(summary.maxGapMs).toBe(550);
    expect(summary.gapCountOver250Ms).toBe(1);
  });

  it('describes the playback window around the current cursor time', () => {
    const entries = [{ t: 0.1 }, { t: 0.2 }, { t: 0.55 }];

    expect(describeTimedEntryWindow([], 0.1)).toEqual({
      state: 'empty',
      previousOffsetMs: null,
      nextOffsetMs: null,
      surroundingGapMs: null,
    });

    expect(describeTimedEntryWindow(entries, 0.05)).toEqual({
      state: 'before-first',
      previousOffsetMs: null,
      nextOffsetMs: 50,
      surroundingGapMs: null,
    });

    expect(describeTimedEntryWindow(entries, 0.16)).toEqual({
      state: 'tracking',
      previousOffsetMs: 60,
      nextOffsetMs: 40,
      surroundingGapMs: 100,
    });

    expect(describeTimedEntryWindow(entries, 0.3)).toEqual({
      state: 'gap',
      previousOffsetMs: 100,
      nextOffsetMs: 250,
      surroundingGapMs: 350,
    });

    expect(describeTimedEntryWindow(entries, 0.8)).toEqual({
      state: 'after-last',
      previousOffsetMs: 250,
      nextOffsetMs: null,
      surroundingGapMs: null,
    });
  });
});
