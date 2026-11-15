import { describe, expect, it } from 'vitest';
import type { MediaSegment } from '../../types/timeline';
import {
  chunkWindows,
  computeChunkKeys,
  hash128,
  selectForWindows,
  splitTimedLists,
  stableStringify,
  timeExtents,
  type ChunkKeyInput,
} from './chunkKeys';
import { planChunks } from './chunkPlan';

const segment = (overrides: Partial<MediaSegment> = {}): MediaSegment =>
  ({
    id: 's1',
    timelineStart: 0,
    timelineEnd: 30,
    sourceStart: 0,
    sourceEnd: 30,
    videoEnabled: true,
    audioEnabled: true,
    ...overrides,
  }) as MediaSegment;

function baseInput(state: Record<string, unknown>, segments = [segment()]): ChunkKeyInput {
  return {
    version: 'v1',
    target: { format: 'mp4', width: 1920, height: 1080, fps: 60, quality: 'high' },
    state,
    segments,
    chunks: planChunks(30 * 60, 60), // 15 chunks of 2 s
    fps: 60,
    lookbackSeconds: 5,
    lookaheadSeconds: 3,
  };
}

const zoom = (start: number, end: number, scale = 2) => ({ id: `z${start}`, start, end, scale });

function changedChunks(a: string[], b: string[]): number[] {
  return a.flatMap((key, i) => (key === b[i] ? [] : [i]));
}

describe('stableStringify / hash128', () => {
  it('ignores key order and undefined fields', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe(
      stableStringify({ a: [1, { d: 2 }], b: 1 }),
    );
  });

  it('produces a fixed-width hex hash that changes with the input', () => {
    expect(hash128('a')).toMatch(/^[0-9a-f]{32}$/);
    expect(hash128('a')).not.toBe(hash128('b'));
    expect(hash128('a')).toBe(hash128('a'));
  });
});

describe('timeExtents / splitTimedLists', () => {
  it('reads every supported time field', () => {
    expect(timeExtents({ start: 1, end: 2 })).toEqual([[1, 2]]);
    expect(timeExtents({ t: 4 })).toEqual([[4, 4]]);
    expect(
      timeExtents(segment({ timelineStart: 0, timelineEnd: 5, sourceStart: 10, sourceEnd: 15 })),
    ).toEqual([
      [0, 5],
      [10, 15],
    ]);
    expect(timeExtents({ label: 'x' })).toBeNull();
  });

  it('keeps arrays with any untimed item in the global part', () => {
    const { global, lists } = splitTimedLists({
      zooms: [zoom(1, 2)],
      mixed: [{ t: 1 }, { label: 'no time' }],
      style: { colour: 'red' },
    });
    expect(lists.map((l) => l.path)).toEqual(['zooms']);
    expect(global).toEqual({
      zooms: '__timed__',
      mixed: [{ t: 1 }, { label: 'no time' }],
      style: { colour: 'red' },
    });
  });

  it('finds timed lists nested in objects and Maps', () => {
    const analysed = new Map<string, unknown>([['cursor', { moveEvents: [{ t: 1, x: 0, y: 0 }] }]]);
    const { lists } = splitTimedLists({ captions: { segments: [{ start: 0, end: 1 }] }, analysed });
    expect(lists.map((l) => l.path).sort()).toEqual([
      'analysed.cursor.moveEvents',
      'captions.segments',
    ]);
  });
});

describe('chunkWindows / selectForWindows', () => {
  it('maps the timeline window into source time through each segment', () => {
    const windows = chunkWindows(2, 6, [
      segment({ timelineStart: 0, timelineEnd: 4, sourceStart: 20, sourceEnd: 24 }),
      segment({
        id: 's2',
        timelineStart: 4,
        timelineEnd: 8,
        sourceStart: 50,
        sourceEnd: 58,
        speed: 2,
      }),
    ]);
    expect(windows).toEqual([
      [2, 6],
      [22, 24],
      [50, 54],
    ]);
  });

  it('includes overlapping items and the last item before the window', () => {
    const list = splitTimedLists([{ t: 1 }, { t: 2 }, { t: 5 }, { t: 9 }]).lists[0];
    expect(selectForWindows(list, [[4, 6]])).toEqual([{ t: 2 }, { t: 5 }]);
  });
});

describe('computeChunkKeys', () => {
  it('is deterministic', () => {
    const state = { zoomClips: [zoom(10, 12)], frame: { padding: 0.1 } };
    expect(computeChunkKeys(baseInput(state))).toEqual(computeChunkKeys(baseInput(state)));
  });

  it('gives every chunk a distinct key', () => {
    const keys = computeChunkKeys(baseInput({ frame: { padding: 0.1 } }));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only refreshes chunks near an edited zoom clip', () => {
    const before = computeChunkKeys(baseInput({ zoomClips: [zoom(3, 4), zoom(20, 22)] }));
    const after = computeChunkKeys(baseInput({ zoomClips: [zoom(3, 4), zoom(20, 22, 3)] }));
    // Clip at 20–22 s, window = chunk −5 s … chunk +3 s → chunks whose
    // [start−5, end+3] overlaps [20, 22]: chunks 8 (16–18 s) … 13 (26–28 s).
    expect(changedChunks(before, after)).toEqual([8, 9, 10, 11, 12, 13]);
  });

  it('refreshes every chunk on a global change', () => {
    const before = computeChunkKeys(
      baseInput({ frame: { padding: 0.1 }, zoomClips: [zoom(1, 2)] }),
    );
    const after = computeChunkKeys(baseInput({ frame: { padding: 0.2 }, zoomClips: [zoom(1, 2)] }));
    expect(changedChunks(before, after)).toHaveLength(before.length);
  });

  it('refreshes every chunk when the export target changes', () => {
    const state = { frame: {} };
    const a = computeChunkKeys(baseInput(state));
    const b = computeChunkKeys({ ...baseInput(state), target: { format: 'mp4', width: 1280 } });
    expect(changedChunks(a, b)).toHaveLength(a.length);
  });

  it('catches source-time data through a trimmed segment', () => {
    // Timeline 0–30 s plays source 17–47 s. Cursor events are in source time.
    const segments = [
      segment({ timelineStart: 0, timelineEnd: 30, sourceStart: 17, sourceEnd: 47 }),
    ];
    const events = (x: number) => ({
      cursor: {
        moveEvents: [
          { t: 18, x: 0, y: 0 },
          { t: 37, x, y: 0 },
          { t: 46, x: 0, y: 0 },
        ],
      },
    });
    const before = computeChunkKeys(baseInput(events(0), segments));
    const after = computeChunkKeys(baseInput(events(1), segments));
    // Event at source 37 s = timeline 20 s. It is in the windows of chunks
    // 8–13, and is the carry-in (last event before the window) up to the next
    // event at timeline 29 s.
    const changed = changedChunks(before, after);
    expect(changed).toContain(10);
    expect(changed).not.toContain(0);
    expect(changed).not.toContain(4);
  });

  it('refreshes chunks from a cut onwards and keeps earlier segments', () => {
    const state = (segments: MediaSegment[]) => ({ mediaSegments: segments });
    const before = [
      segment({ timelineStart: 0, timelineEnd: 10, sourceStart: 0, sourceEnd: 10 }),
      segment({ id: 's2', timelineStart: 10, timelineEnd: 30, sourceStart: 10, sourceEnd: 30 }),
    ];
    // Cut 2 s out of the second segment.
    const after = [
      before[0],
      segment({ id: 's2', timelineStart: 10, timelineEnd: 28, sourceStart: 12, sourceEnd: 30 }),
    ];
    const changed = changedChunks(
      computeChunkKeys(baseInput(state(before), before)),
      computeChunkKeys(baseInput(state(after), after)),
    );
    // Chunks 0–1 (0–4 s) are more than the 5 s look-back away from s2.
    expect(changed).not.toContain(0);
    expect(changed).not.toContain(1);
    expect(changed).toContain(5);
    expect(changed).toContain(14);
  });

  it('keeps chunks before a cut inside one long segment', () => {
    // The whole timeline is one segment; cut 3 s out at 20 s. Only the
    // segment's end moves within chunks before the cut, and that end is
    // outside their windows.
    const whole = [
      segment({ id: 'orig', timelineStart: 0, timelineEnd: 30, sourceStart: 17, sourceEnd: 47 }),
    ];
    const cut = [
      segment({ id: 'a', timelineStart: 0, timelineEnd: 20, sourceStart: 17, sourceEnd: 37 }),
      segment({ id: 'b', timelineStart: 20, timelineEnd: 27, sourceStart: 40, sourceEnd: 47 }),
    ];
    const state = (segments: MediaSegment[]) => ({ mediaSegments: segments });
    const changed = changedChunks(
      computeChunkKeys(baseInput(state(whole), whole)),
      computeChunkKeys(baseInput(state(cut), cut)),
    );
    // Chunk 7 (14–16 s) has the window 9–19 s: the cut at 20 s is outside it.
    expect(changed.filter((i) => i <= 7)).toEqual([]);
    expect(changed).toContain(8);
    expect(changed).toContain(10);
  });

  it('refreshes a chunk whose window holds an edited segment edge or transition', () => {
    const before = [
      segment({
        timelineStart: 0,
        timelineEnd: 30,
        transitionIn: { type: 'fade', duration: 0.35 },
      } as never),
    ];
    const after = [
      segment({
        timelineStart: 0,
        timelineEnd: 30,
        transitionIn: { type: 'fade', duration: 0.8 },
      } as never),
    ];
    const state = (segments: MediaSegment[]) => ({ mediaSegments: segments });
    const changed = changedChunks(
      computeChunkKeys(baseInput(state(before), before)),
      computeChunkKeys(baseInput(state(after), after)),
    );
    // The fade-in at 0 s is inside the windows of chunks 0–2 (look-back 5 s).
    expect(changed).toEqual([0, 1, 2]);
  });

  it('carries the last cursor event into later chunks, but not old clips', () => {
    const parked = (x: number) => ({ cursor: { moveEvents: [{ t: 1, x, y: 0 }] } });
    const cursorChanged = changedChunks(
      computeChunkKeys(baseInput(parked(0))),
      computeChunkKeys(baseInput(parked(1))),
    );
    // A parked cursor's position shows in every later chunk.
    expect(cursorChanged).toHaveLength(15);
  });
});
