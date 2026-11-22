import { describe, expect, it } from 'vitest';
import type { MaskClip, MediaSegment, ZoomClip } from '../../types/timeline';
import type { MotionClip } from '../animation/motionClips';
import {
  applyTimelineCuts,
  collapseClipsOverRanges,
  collapseTimeOverRanges,
  cutMediaSegmentRanges,
  normalizeTimeRanges,
  resolveTimelineCuts,
  type TimelineCutState,
} from './segments';

const seg = (patch: Partial<MediaSegment> & Pick<MediaSegment, 'id'>): MediaSegment => ({
  timelineStart: 0,
  timelineEnd: 10,
  sourceStart: 0,
  sourceEnd: 10,
  videoEnabled: true,
  audioEnabled: true,
  ...patch,
});

/** Total kept timeline length — must equal the original minus what was cut. */
const length = (segments: MediaSegment[]) =>
  segments.reduce((sum, s) => sum + (s.timelineEnd - s.timelineStart), 0);

describe('normalizeTimeRanges', () => {
  it('sorts, merges overlaps and drops empty ranges', () => {
    expect(
      normalizeTimeRanges([
        { start: 5, end: 6 },
        { start: 1, end: 2 },
        { start: 1.5, end: 3 },
        { start: 4, end: 4 },
      ]),
    ).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 6 },
    ]);
  });

  it('joins ranges closer than the join gap', () => {
    expect(
      normalizeTimeRanges(
        [
          { start: 1, end: 2 },
          { start: 2.05, end: 3 },
        ],
        0.1,
      ),
    ).toEqual([{ start: 1, end: 3 }]);
  });
});

describe('resolveTimelineCuts', () => {
  it('keeps a cut inside a clip as it is', () => {
    expect(resolveTimelineCuts([seg({ id: 'v' })], [{ start: 2, end: 3 }])).toEqual([
      { start: 2, end: 3 },
    ]);
  });

  it('drops the parts of a cut that fall outside every clip', () => {
    const segments = [
      seg({ id: 'a', timelineStart: 0, timelineEnd: 4, sourceEnd: 4 }),
      seg({ id: 'b', timelineStart: 6, timelineEnd: 10, sourceStart: 6, sourceEnd: 10 }),
    ];
    expect(resolveTimelineCuts(segments, [{ start: 3, end: 7 }])).toEqual([
      { start: 3, end: 4 },
      { start: 6, end: 7 },
    ]);
    expect(resolveTimelineCuts(segments, [{ start: 4.5, end: 5.5 }])).toEqual([]);
  });

  it('closes up slivers too short to keep at a clip edge or between two cuts', () => {
    expect(
      resolveTimelineCuts(
        [seg({ id: 'v' })],
        [
          { start: 0.04, end: 1 },
          { start: 1.05, end: 2 },
          { start: 9, end: 9.97 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 9, end: 10 },
    ]);
  });
});

describe('cutMediaSegmentRanges', () => {
  it('splits a clip around a cut and closes the gap', () => {
    const { segments, replaced } = cutMediaSegmentRanges(
      [seg({ id: 'v' })],
      [{ start: 2, end: 3 }],
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      timelineStart: 0,
      timelineEnd: 2,
      sourceStart: 0,
      sourceEnd: 2,
    });
    expect(segments[1]).toMatchObject({
      timelineStart: 2,
      timelineEnd: 9,
      sourceStart: 3,
      sourceEnd: 10,
    });
    expect(replaced.get('v')).toEqual(segments.map((s) => s.id));
    expect(new Set(segments.map((s) => s.id)).size).toBe(2);
  });

  it('maps cuts through clip speed', () => {
    // A 2x clip: timeline 0–5 plays source 0–10.
    const { segments } = cutMediaSegmentRanges(
      [seg({ id: 'v', timelineEnd: 5, speed: 2 })],
      [{ start: 1, end: 2 }],
    );
    expect(segments[0]).toMatchObject({ timelineEnd: 1, sourceEnd: 2, speed: 2 });
    expect(segments[1]).toMatchObject({
      timelineStart: 1,
      timelineEnd: 4,
      sourceStart: 4,
      sourceEnd: 10,
      speed: 2,
    });
  });

  it('removes a clip the cut covers and shifts later clips, leaving untouched clips as they were', () => {
    const a = seg({ id: 'a', timelineEnd: 4, sourceEnd: 4 });
    const b = seg({ id: 'b', timelineStart: 4, timelineEnd: 6, sourceStart: 4, sourceEnd: 6 });
    const c = seg({ id: 'c', timelineStart: 6, timelineEnd: 10, sourceStart: 6, sourceEnd: 10 });
    const { segments, replaced } = cutMediaSegmentRanges([c, a, b], [{ start: 4, end: 6 }]);
    expect(segments.map((s) => s.id)).toEqual(['a', 'c']);
    expect(segments[0]).toBe(a);
    expect(segments[1]).toMatchObject({ timelineStart: 4, timelineEnd: 8, sourceStart: 6 });
    expect(replaced.get('b')).toEqual([]);
    expect(replaced.has('a')).toBe(false);
  });

  it('keeps gaps between clips and shifts later clips by every cut before them', () => {
    const segments = [
      seg({ id: 'a', timelineEnd: 4, sourceEnd: 4 }),
      seg({ id: 'b', timelineStart: 5, timelineEnd: 9, sourceStart: 4, sourceEnd: 8 }),
    ];
    const result = cutMediaSegmentRanges(segments, [
      { start: 1, end: 2 },
      { start: 6, end: 7 },
    ]);
    expect(result.segments.map((s) => [s.timelineStart, s.timelineEnd])).toEqual([
      [0, 1],
      [1, 3],
      [4, 5],
      [5, 7],
    ]);
    expect(length(result.segments)).toBeCloseTo(length(segments) - 2);
  });

  it('shifts a track by cuts it does not cover itself (camera clips stay in sync)', () => {
    const camera = [seg({ id: 'cam', timelineStart: 5, timelineEnd: 8, sourceEnd: 3 })];
    const { segments } = cutMediaSegmentRanges(camera, [{ start: 1, end: 2 }]);
    expect(segments[0]).toMatchObject({ timelineStart: 4, timelineEnd: 7, sourceStart: 0 });
  });

  it('gives cut edges no transition and keeps the clip’s own transitions on its outer edges', () => {
    const fade = { type: 'fade' as const, duration: 0.35 };
    const { segments } = cutMediaSegmentRanges(
      [seg({ id: 'v', transitionIn: fade, transitionOut: fade })],
      [{ start: 2, end: 3 }],
    );
    expect(segments[0].transitionIn).toEqual(fade);
    expect(segments[0].transitionOut).toEqual({ type: 'none', duration: 0 });
    expect(segments[1].transitionIn).toEqual({ type: 'none', duration: 0 });
    expect(segments[1].transitionOut).toEqual(fade);
  });
});

describe('collapseTimeOverRanges', () => {
  const ranges = [
    { start: 2, end: 3 },
    { start: 5, end: 7 },
  ];
  it('moves a time left by the cuts before it, and a time inside a cut to where the cut was', () => {
    expect(collapseTimeOverRanges(1, ranges)).toBe(1);
    expect(collapseTimeOverRanges(2.5, ranges)).toBe(2);
    expect(collapseTimeOverRanges(4, ranges)).toBe(3);
    expect(collapseTimeOverRanges(6, ranges)).toBe(4);
    expect(collapseTimeOverRanges(10, ranges)).toBe(7);
  });
});

describe('collapseClipsOverRanges', () => {
  it('shortens a clip a cut runs through instead of splitting it, and drops clips inside a cut', () => {
    const clips = [
      { id: 'over', start: 1, end: 4 },
      { id: 'inside', start: 2.2, end: 2.8 },
      { id: 'after', start: 5, end: 6 },
    ];
    expect(collapseClipsOverRanges(clips, [{ start: 2, end: 3 }], 0.05)).toEqual([
      { id: 'over', start: 1, end: 3 },
      { id: 'after', start: 4, end: 5 },
    ]);
  });
});

/** applyTimelineCuts for a cut the test knows will happen. */
const cut = (state: TimelineCutState, ranges: Array<{ start: number; end: number }>) => {
  const result = applyTimelineCuts(state, ranges);
  if (!result) {
    throw new Error('expected a cut');
  }
  return result;
};

describe('applyTimelineCuts', () => {
  const zoom = (id: string, start: number, end: number): ZoomClip =>
    ({ id, start, end, scale: 2, cx: 0.5, cy: 0.5, easeIn: 0.3, easeOut: 0.3 }) as ZoomClip;
  const motion = (patch: Partial<MotionClip>): MotionClip => ({
    id: 'm',
    move: 'fadeIn',
    start: 0,
    end: 1,
    amount: 'default',
    feel: 'smooth',
    ...patch,
  });
  const base = (): TimelineCutState => ({
    mediaSegments: [seg({ id: 'v' })],
    cameraMediaSegments: [seg({ id: 'cam' })],
    zoomClips: [zoom('z', 1, 5), zoom('later', 6, 8)],
    cameraClips: [],
    maskClips: [],
    motionClips: [
      motion({ id: 'intro', clipId: 'v', start: 0, end: 1 }),
      motion({ id: 'outro', move: 'fadeOut', clipId: 'v', start: 9, end: 10 }),
    ],
  });

  it('returns null when nothing on the timeline would be cut', () => {
    expect(applyTimelineCuts(base(), [])).toBeNull();
    expect(applyTimelineCuts(base(), [{ start: 20, end: 21 }])).toBeNull();
  });

  it('cuts the video and camera together and closes up zoom clips', () => {
    const result = cut(base(), [{ start: 2, end: 3 }]);
    expect(length(result.mediaSegments)).toBeCloseTo(9);
    expect(length(result.cameraMediaSegments)).toBeCloseTo(9);
    expect(result.zoomClips).toEqual([
      expect.objectContaining({ id: 'z', start: 1, end: 4 }),
      expect.objectContaining({ id: 'later', start: 5, end: 7 }),
    ]);
    expect(result.cutRanges).toEqual([{ start: 2, end: 3 }]);
  });

  it('keeps a privacy mask while any of the video it covers survives the cut', () => {
    const mask = {
      id: 'mask',
      start: 1,
      end: 2,
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
      type: 'blur',
      blurAmount: 20,
      color: '#000000',
    } as MaskClip;
    const result = cut({ ...base(), maskClips: [mask] }, [{ start: 1.04, end: 2 }]);
    expect(length(result.mediaSegments)).toBeCloseTo(9.04);
    expect(result.maskClips).toHaveLength(1);
    expect(result.maskClips[0].start).toBeCloseTo(1);
    expect(result.maskClips[0].end).toBeCloseTo(1.04);

    // A mask whose video is cut away entirely goes with it.
    expect(cut({ ...base(), maskClips: [mask] }, [{ start: 1, end: 2 }]).maskClips).toEqual([]);
  });

  it('keeps the clip intro on the first piece and the outro on the last', () => {
    const result = cut(base(), [{ start: 0, end: 0.5 }]);
    const [only] = result.mediaSegments;
    expect(result.mediaSegments).toHaveLength(1);
    const intro = result.motionClips.find((c) => c.id === 'intro');
    const outro = result.motionClips.find((c) => c.id === 'outro');
    expect(intro?.clipId).toBe(only.id);
    expect(outro).toMatchObject({ clipId: only.id, start: 8.5, end: 9.5 });

    const split = cut(base(), [{ start: 4, end: 5 }]);
    const ids = split.mediaSegments.map((s) => s.id);
    expect(split.motionClips.find((c) => c.id === 'intro')?.clipId).toBe(ids[0]);
    expect(split.motionClips.find((c) => c.id === 'outro')?.clipId).toBe(ids[1]);
  });
});
