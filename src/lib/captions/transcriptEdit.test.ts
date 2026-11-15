import { describe, expect, it } from 'vitest';
import type { CaptionSegment, CursorEvent, RecordingResult } from '../../types';
import type { MediaSegment } from '../../types/timeline';
import {
  flattenTranscript,
  getActivityTimes,
  getWordCutRanges,
  getWordKey,
  getWordRangeKeys,
  getWordTimelineSpan,
  isWordOnTimeline,
  mapSourceRangeToTimeline,
  planCleanup,
  sumRanges,
} from './transcriptEdit';

const words = (list: Array<[string, number, number]>) =>
  list.map(([word, start, end]) => ({ word, start, end }));

const line = (
  id: string,
  list: Array<[string, number, number]>,
  patch: Partial<CaptionSegment> = {},
): CaptionSegment => {
  const w = words(list);
  return {
    id,
    start: w[0].start,
    end: w[w.length - 1].end,
    text: w.map((x) => x.word).join(' '),
    words: w,
    ...patch,
  };
};

const seg = (patch: Partial<MediaSegment> & Pick<MediaSegment, 'id'>): MediaSegment => ({
  timelineStart: 0,
  timelineEnd: 20,
  sourceStart: 0,
  sourceEnd: 20,
  ...patch,
});

/** One uncut clip, 20 s long. */
const whole = [seg({ id: 'v' })];

/** The same 20 s recording with source 4–6 already cut out. */
const alreadyCut = [
  seg({ id: 'a', timelineEnd: 4, sourceEnd: 4 }),
  seg({ id: 'b', timelineStart: 4, timelineEnd: 18, sourceStart: 6, sourceEnd: 20 }),
];

const transcript: CaptionSegment[] = [
  line('s1', [
    ['So', 0.5, 0.8],
    ['um,', 0.9, 1.3],
    ['this', 1.4, 1.7],
    ['is', 1.8, 2.0],
    ['it.', 2.1, 2.5],
  ]),
  line('s2', [
    ['Uh', 5.0, 5.3],
    ['next', 5.4, 5.8],
    ['part', 5.9, 6.4],
  ]),
  line('s3', [
    ['done', 9.0, 9.5],
    ['here', 9.6, 10.0],
  ]),
];

describe('flattenTranscript', () => {
  it('lists every word in order with a key that names its line and position', () => {
    const flat = flattenTranscript(transcript);
    expect(flat).toHaveLength(10);
    expect(flat[0]).toMatchObject({ key: getWordKey('s1', 0), segmentId: 's1', index: 0 });
    expect(flat[5]).toMatchObject({ key: 's2:0', word: 'Uh', start: 5, end: 5.3 });
  });

  it('marks words from a hand-edited line, whose timings are only estimates', () => {
    const flat = flattenTranscript([line('e', [['hello', 0, 1]], { edited: true })]);
    expect(flat[0].edited).toBe(true);
  });
});

describe('getWordRangeKeys', () => {
  it('returns every word between two keys, in either order', () => {
    const flat = flattenTranscript(transcript);
    expect(getWordRangeKeys(flat, 's1:3', 's2:1')).toEqual(['s1:3', 's1:4', 's2:0', 's2:1']);
    expect(getWordRangeKeys(flat, 's2:1', 's1:3')).toEqual(['s1:3', 's1:4', 's2:0', 's2:1']);
    expect(getWordRangeKeys(flat, 'missing', 's1:0')).toEqual(['s1:0']);
  });
});

describe('mapSourceRangeToTimeline', () => {
  it('maps a source range onto the clips that still play it', () => {
    expect(mapSourceRangeToTimeline(whole, { start: 2, end: 3 })).toEqual([{ start: 2, end: 3 }]);
    expect(mapSourceRangeToTimeline(alreadyCut, { start: 3, end: 7 })).toEqual([
      { start: 3, end: 4 },
      { start: 4, end: 5 },
    ]);
    expect(mapSourceRangeToTimeline(alreadyCut, { start: 4.5, end: 5.5 })).toEqual([]);
  });

  it('accounts for clip speed', () => {
    const fast = [seg({ id: 'f', timelineEnd: 10, speed: 2 })];
    expect(mapSourceRangeToTimeline(fast, { start: 4, end: 6 })).toEqual([{ start: 2, end: 3 }]);
  });
});

describe('isWordOnTimeline / getWordTimelineSpan', () => {
  it('knows which words were already cut', () => {
    expect(isWordOnTimeline(alreadyCut, { start: 5.0, end: 5.3 })).toBe(false);
    expect(isWordOnTimeline(alreadyCut, { start: 9, end: 9.5 })).toBe(true);
    expect(getWordTimelineSpan(alreadyCut, { start: 9, end: 9.5 })).toEqual({ start: 7, end: 7.5 });
    expect(getWordTimelineSpan(alreadyCut, { start: 4.5, end: 5 })).toBeNull();
  });
});

describe('getWordCutRanges', () => {
  it('cuts a single word at its own timing', () => {
    const flat = flattenTranscript(transcript);
    expect(getWordCutRanges(flat, whole, new Set(['s1:1']))).toEqual([{ start: 0.9, end: 1.3 }]);
  });

  it('cuts neighbouring words as one range, including the pauses between them', () => {
    const flat = flattenTranscript(transcript);
    expect(getWordCutRanges(flat, whole, new Set(['s1:3', 's1:4', 's2:0']))).toEqual([
      { start: 1.8, end: 5.3 },
    ]);
  });

  it('cuts in timeline time on a video that already has cuts', () => {
    const flat = flattenTranscript(transcript);
    // "done here" sits at source 9–10, which plays at timeline 7–8 after the earlier cut.
    expect(getWordCutRanges(flat, alreadyCut, new Set(['s3:0', 's3:1']))).toEqual([
      { start: 7, end: 8 },
    ]);
  });

  it('treats words either side of an already-cut word as neighbours', () => {
    const flat = flattenTranscript(transcript);
    // "it." (source 2.1–2.5) and "part" (5.9–6.4): "Uh next" between them is already cut,
    // and "part" now plays at timeline 4–4.4.
    const ranges = getWordCutRanges(flat, alreadyCut, new Set(['s1:4', 's2:2']));
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBeCloseTo(2.1);
    expect(ranges[0].end).toBeCloseTo(4.4);
  });
});

describe('planCleanup', () => {
  const options = {
    language: 'en',
    fillers: true,
    silences: true,
    minSilence: 1,
    silencePad: 0.2,
  };

  it('finds filler words and long pauses and totals what would be removed', () => {
    const plan = planCleanup(transcript, whole, options);
    const fillers = plan.cuts.filter((c) => c.kind === 'filler');
    const silences = plan.cuts.filter((c) => c.kind === 'silence');
    expect(fillers.map((c) => c.wordKey)).toEqual(['s1:1', 's2:0']);
    // Pauses: 2.5→5.0 (before "Uh") and 6.4→9.0 (before "done"), each trimmed by 0.2 a side.
    expect(silences.map((c) => c.wordKey)).toEqual(['s2:0', 's3:0']);
    expect(silences[0].ranges).toEqual([{ start: 2.7, end: 4.8 }]);
    expect(silences[1].ranges[0].start).toBeCloseTo(6.6);
    expect(silences[1].ranges[0].end).toBeCloseTo(8.8);
    expect(plan.totalDuration).toBeCloseTo(sumRanges(plan.ranges));
    expect(plan.ranges.length).toBeGreaterThan(0);
  });

  it('leaves out what the user switched off', () => {
    expect(planCleanup(transcript, whole, { ...options, silences: false }).cuts).toHaveLength(2);
    expect(
      planCleanup(transcript, whole, { ...options, fillers: false }).cuts.every(
        (c) => c.kind === 'silence',
      ),
    ).toBe(true);
    expect(planCleanup(transcript, whole, { ...options, fillers: false, silences: false })).toEqual(
      {
        cuts: [],
        ranges: [],
        totalDuration: 0,
      },
    );
  });

  it('respects the pause threshold', () => {
    const plan = planCleanup(transcript, whole, { ...options, fillers: false, minSilence: 2.55 });
    expect(plan.cuts.map((c) => c.wordKey)).toEqual(['s3:0']);
  });

  it('keeps pauses where the user clicked, typed or scrolled', () => {
    const plan = planCleanup(transcript, whole, {
      ...options,
      fillers: false,
      activityTimes: [7.5],
    });
    expect(plan.cuts.map((c) => c.wordKey)).toEqual(['s2:0']);
  });

  it('skips words that were already cut and measures pauses on the timeline', () => {
    // With source 4–6 cut, "Uh next" are gone and the pause before "part" is 2.5→4 on the
    // timeline.
    const plan = planCleanup(transcript, alreadyCut, options);
    expect(plan.cuts.filter((c) => c.kind === 'filler').map((c) => c.wordKey)).toEqual(['s1:1']);
    const silences = plan.cuts.filter((c) => c.kind === 'silence');
    expect(silences.map((c) => c.wordKey)).toEqual(['s2:2', 's3:0']);
    expect(silences[0].ranges[0].start).toBeCloseTo(2.7);
    expect(silences[0].ranges[0].end).toBeCloseTo(3.8);
  });

  it('does not treat words from a hand-edited line as fillers', () => {
    const edited = [line('e', [['um', 0, 0.5]], { edited: true })];
    expect(planCleanup(edited, whole, options).cuts).toEqual([]);
  });

  it('only uses the filler list of the transcript language', () => {
    const german = [
      line('g', [
        ['er', 0, 0.3],
        ['ähm', 0.4, 0.8],
        ['kommt', 0.9, 1.2],
      ]),
    ];
    const plan = planCleanup(german, whole, { ...options, language: 'de', silences: false });
    expect(plan.cuts.map((c) => c.wordKey)).toEqual(['g:1']);
  });
});

describe('getActivityTimes', () => {
  it('returns the source times of clicks, key presses and scrolls, not plain mouse moves', () => {
    const mouseData: CursorEvent[] = [
      { type: 'move', x: 1, y: 1, timestamp: 1000 },
      { type: 'mousedown', x: 1, y: 1, timestamp: 1500 },
      { type: 'mouseup', x: 1, y: 1, timestamp: 1600 },
      { type: 'keydown', timestamp: 3000 },
      { type: 'scroll', timestamp: 4000 },
    ];
    const recording = { mouseData, startTime: 1000 } as RecordingResult;
    expect(getActivityTimes(recording)).toEqual([0.5, 2, 3]);
    expect(getActivityTimes(null)).toEqual([]);
  });
});
