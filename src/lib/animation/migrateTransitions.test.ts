import { describe, expect, it } from 'vitest';
import { migrateTransitionsToMotion } from './migrateTransitions';
import { layoutMotionClips, resolveMotionAt } from './motionClips';
import type { MediaSegment } from '../../types/timeline';

const seg = (patch: Partial<MediaSegment> & Pick<MediaSegment, 'id'>): MediaSegment => ({
  timelineStart: 0,
  timelineEnd: 4,
  sourceStart: 0,
  sourceEnd: 4,
  videoEnabled: true,
  audioEnabled: true,
  ...patch,
});

describe('migrateTransitionsToMotion', () => {
  it("turns each clip's default fade-in into a Fade in intro on that clip", () => {
    const { motionClips, mediaSegments } = migrateTransitionsToMotion(
      [seg({ id: 'a' }), seg({ id: 'b', timelineStart: 4, timelineEnd: 8 })],
      [],
    );
    expect(motionClips.map((c) => [c.move, c.clipId, +(c.end - c.start).toFixed(2)])).toEqual([
      ['fadeIn', 'a', 0.35],
      ['fadeIn', 'b', 0.35],
    ]);
    expect(mediaSegments.every((s) => !s.transitionIn && !s.transitionOut)).toBe(true);
  });

  it('keeps the direction of slides and maps grow and shrink', () => {
    const { motionClips } = migrateTransitionsToMotion(
      [
        seg({
          id: 'a',
          transitionIn: { type: 'none', duration: 0 },
          transitionOut: { type: 'slide-left', duration: 0.6 },
        }),
        seg({
          id: 'b',
          timelineStart: 4,
          timelineEnd: 8,
          transitionIn: { type: 'slide-up', duration: 0.4 },
          transitionOut: { type: 'grow', duration: 0.5 },
        }),
        seg({
          id: 'c',
          timelineStart: 8,
          timelineEnd: 12,
          transitionIn: { type: 'shrink', duration: 0.5 },
        }),
      ],
      [],
    );
    expect(motionClips.map((c) => `${c.clipId}:${c.move}`)).toEqual([
      'a:slideLeftOut',
      'b:slideUpIn',
      'b:pushThrough',
      'c:zoomIn',
    ]);
  });

  it('turns Fade white and Blur into a plain fade', () => {
    const { motionClips } = migrateTransitionsToMotion(
      [
        seg({ id: 'a', transitionOut: { type: 'fade-white', duration: 0.4 } }),
        seg({
          id: 'b',
          timelineStart: 4,
          timelineEnd: 8,
          transitionIn: { type: 'blur', duration: 0.4 },
        }),
      ],
      [],
    );
    expect(motionClips.map((c) => c.move)).toEqual(['fadeIn', 'fadeOut', 'fadeIn']);
  });

  it("skips a lone clip's fade-out, which never rendered", () => {
    const { motionClips } = migrateTransitionsToMotion(
      [
        seg({
          id: 'a',
          transitionIn: { type: 'none', duration: 0 },
          transitionOut: { type: 'fade', duration: 0.4 },
        }),
      ],
      [],
    );
    expect(motionClips).toEqual([]);
  });

  it("keeps a lone clip's slide, grow, shrink and blur outros, which did render", () => {
    const outro = (type: 'slide-up' | 'grow' | 'shrink' | 'blur') =>
      migrateTransitionsToMotion(
        [
          seg({
            id: 'a',
            transitionIn: { type: 'none', duration: 0 },
            transitionOut: { type, duration: 0.5 },
          }),
        ],
        [],
      ).motionClips.map((c) => c.move);
    expect(outro('slide-up')).toEqual(['slideUpOut']);
    expect(outro('grow')).toEqual(['pushThrough']);
    expect(outro('shrink')).toEqual(['zoomOut']);
    expect(outro('blur')).toEqual(['fadeOut']);
  });

  it('keeps a lone clip visible through its slide outro, as before', () => {
    const segments = [
      seg({
        id: 'a',
        transitionIn: { type: 'none', duration: 0 },
        transitionOut: { type: 'slide-left', duration: 0.5 },
      }),
    ];
    const { motionClips, mediaSegments } = migrateTransitionsToMotion(segments, []);
    const end = resolveMotionAt(motionClips, mediaSegments, 3.99);
    expect(end.opacity).toBe(1);
    expect(end.x).toBeLessThan(-0.3);
  });

  it('keeps short transitions at their saved length', () => {
    const { motionClips, mediaSegments } = migrateTransitionsToMotion(
      [
        seg({
          id: 'a',
          transitionIn: { type: 'fade', duration: 0.1 },
          transitionOut: { type: 'slide-up', duration: 0.15 },
        }),
        seg({
          id: 'b',
          timelineStart: 4,
          timelineEnd: 8,
          transitionIn: { type: 'fade', duration: 0 },
        }),
      ],
      [],
    );
    expect(
      layoutMotionClips(motionClips, mediaSegments).map((c) => [
        c.move,
        +(c.end - c.start).toFixed(2),
      ]),
    ).toEqual([
      ['fadeIn', 0.1],
      ['slideUpOut', 0.15],
    ]);
  });

  it('does not add an intro where the clip already has one', () => {
    const existing = {
      id: 'mine',
      move: 'tiltIn' as const,
      start: 0,
      end: 1.6,
      amount: 'default' as const,
      feel: 'smooth' as const,
      clipId: 'a',
    };
    const { motionClips } = migrateTransitionsToMotion([seg({ id: 'a' })], [existing]);
    expect(motionClips.map((c) => c.id)).toEqual(['mine']);
  });

  it('renders the converted cut: clip A fades out, clip B fades in', () => {
    const segments = [
      seg({
        id: 'a',
        transitionIn: { type: 'none', duration: 0 },
        transitionOut: { type: 'fade', duration: 0.4 },
      }),
      seg({ id: 'b', timelineStart: 4, timelineEnd: 8 }),
    ];
    const { motionClips, mediaSegments } = migrateTransitionsToMotion(segments, []);
    expect(layoutMotionClips(motionClips, mediaSegments)).toHaveLength(2);
    expect(resolveMotionAt(motionClips, mediaSegments, 3.99).opacity).toBeLessThan(0.1);
    expect(resolveMotionAt(motionClips, mediaSegments, 4.02).opacity).toBeLessThan(0.5);
    expect(resolveMotionAt(motionClips, mediaSegments, 5).opacity).toBe(1);
  });
});
