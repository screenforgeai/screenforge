import { describe, expect, it } from 'vitest';
import {
  addIntroAndOutro,
  addMotionAt,
  addPinnedMove,
  getClipPoses,
  getMotionGroup,
  layoutMotionClips,
  MOTION_MOVE_IDS,
  MOTION_MOVES,
  normalizeMotionClips,
  placeMotionClip,
  repinMotionClips,
  resolveMotionAt,
  rippleMotionClips,
  setClipMove,
  swapClipPoses,
} from './motionClips';
import type { MotionClip, MotionSegment } from './motionClips';
import { isIdentityMotion } from './sceneMotion';

const clip = (patch: Partial<MotionClip>): MotionClip => ({
  id: patch.id ?? 'c',
  move: 'slowPush',
  start: 0,
  end: 1,
  amount: 'default',
  feel: 'smooth',
  ...patch,
});

/** One clip spanning the whole video. */
const video = (duration: number): MotionSegment[] => [
  { id: 'v', timelineStart: 0, timelineEnd: duration },
];

/** Three clips: 0–4, 4–8, a gap, 9–12. */
const cuts: MotionSegment[] = [
  { id: 'a', timelineStart: 0, timelineEnd: 4 },
  { id: 'b', timelineStart: 4, timelineEnd: 8 },
  { id: 'c', timelineStart: 9, timelineEnd: 12 },
];

describe('resolveMotionAt', () => {
  it('is at rest with no clips', () => {
    expect(isIdentityMotion(resolveMotionAt([], video(10), 3))).toBe(true);
  });

  it('starts an intro from its offset pose and settles at rest', () => {
    const clips = [clip({ id: 'a', move: 'tiltIn', start: 0, end: 2 })];
    const start = resolveMotionAt(clips, video(10), 0);
    expect(start.tiltX).toBeGreaterThan(0);
    expect(start.opacity).toBe(0);
    expect(isIdentityMotion(resolveMotionAt(clips, video(10), 2))).toBe(true);
    expect(isIdentityMotion(resolveMotionAt(clips, video(10), 5))).toBe(true);
  });

  it('holds the end pose of a move through the gap after it', () => {
    const clips = [clip({ id: 'a', move: 'slowPush', start: 1, end: 3 })];
    expect(resolveMotionAt(clips, video(10), 0.5).scale).toBe(1);
    expect(resolveMotionAt(clips, video(10), 5).scale).toBeCloseTo(1.08, 5);
  });

  it('chains a move from where the previous one ended, with no jump', () => {
    const clips = [
      clip({ id: 'a', move: 'slowPush', start: 0, end: 5 }),
      clip({ id: 'b', move: 'tiltAway', start: 8, end: 10 }),
    ];
    const before = resolveMotionAt(clips, video(10), 7.999);
    const at = resolveMotionAt(clips, video(10), 8);
    expect(at.scale).toBeCloseTo(before.scale, 3);
    expect(resolveMotionAt(clips, video(10), 10).opacity).toBe(0);
  });

  it('pins an outro to the end of the video when the video gets shorter', () => {
    const clips = [clip({ id: 'b', move: 'fadeOut', start: 18, end: 20 })];
    expect(resolveMotionAt(clips, video(12), 12).opacity).toBe(0);
    expect(resolveMotionAt(clips, video(12), 9).opacity).toBe(1);
  });

  it('a stronger amount moves further', () => {
    const subtle = resolveMotionAt(
      [clip({ move: 'tiltIn', end: 2, amount: 'subtle' })],
      video(10),
      0,
    );
    const strong = resolveMotionAt(
      [clip({ move: 'tiltIn', end: 2, amount: 'strong' })],
      video(10),
      0,
    );
    expect(strong.tiltX).toBeGreaterThan(subtle.tiltX);
  });

  it('orbit sways during the clip and returns to rest at both ends', () => {
    const clips = [clip({ move: 'orbit', start: 0, end: 12 })];
    expect(isIdentityMotion(resolveMotionAt(clips, video(12), 0))).toBe(true);
    expect(Math.abs(resolveMotionAt(clips, video(12), 3).tiltY)).toBeGreaterThan(1);
    expect(isIdentityMotion(resolveMotionAt(clips, video(12), 12))).toBe(true);
  });
});

describe('intros and outros on clips', () => {
  it('pins an intro and outro to the clip they belong to', () => {
    const clips = [
      clip({ id: 'out-a', move: 'fadeOut', start: 0, end: 0.5, clipId: 'a' }),
      clip({ id: 'in-b', move: 'slideLeftIn', start: 0, end: 0.5, clipId: 'b' }),
    ];
    const laid = layoutMotionClips(clips, cuts);
    expect(laid.map((c) => [c.id, c.start, c.end])).toEqual([
      ['out-a', 3.5, 4],
      ['in-b', 4, 4.5],
    ]);
  });

  it("starts the next clip fresh after an outro, so a faded-out clip doesn't hide it", () => {
    const clips = [clip({ id: 'out-a', move: 'fadeOut', start: 3.5, end: 4, clipId: 'a' })];
    expect(resolveMotionAt(clips, cuts, 4).opacity).toBe(0);
    expect(resolveMotionAt(clips, cuts, 4.2).opacity).toBe(1);
  });

  it('an intro starts from its own pose even after a move that is still carrying', () => {
    const clips = [
      clip({ id: 'push', move: 'slowPush', start: 0.5, end: 3 }),
      clip({ id: 'in-b', move: 'fadeIn', start: 4, end: 4.5, clipId: 'b' }),
    ];
    const mid = resolveMotionAt(clips, cuts, 4.25);
    expect(mid.scale).toBe(1);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
  });

  it('follows its clip when the clip moves, and sits out when the clip is deleted', () => {
    const intro = clip({ id: 'in-c', move: 'fadeIn', start: 9, end: 9.5, clipId: 'c' });
    const moved = cuts.map((s) => (s.id === 'c' ? { ...s, timelineStart: 8, timelineEnd: 11 } : s));
    expect(layoutMotionClips([intro], moved)[0].start).toBe(8);
    expect(layoutMotionClips([intro], cuts.slice(0, 2))).toEqual([]);
  });

  it('keeps moves in between out of pinned intros and outros', () => {
    const clips = [
      clip({ id: 'push', move: 'slowPush', start: 2, end: 7 }),
      clip({ id: 'out-a', move: 'fadeOut', start: 3.5, end: 4, clipId: 'a' }),
    ];
    const push = layoutMotionClips(clips, cuts).find((c) => c.id === 'push');
    expect(push?.end).toBe(3.5);
  });

  it('shortens an intro and outro that would collide on a short clip, and says so', () => {
    const clips = [
      clip({ id: 'in', move: 'tiltIn', start: 0, end: 2, clipId: 'c' }),
      clip({ id: 'out', move: 'tiltAway', start: 0, end: 2, clipId: 'c' }),
    ];
    const laid = layoutMotionClips(clips, cuts);
    expect(laid[0].end).toBeLessThanOrEqual(laid[1].start);
    expect(laid[1].end).toBe(12);
    expect(laid.every((c) => c.shortened)).toBe(true);
  });

  it('moves an outro to the right-hand piece when its clip is split', () => {
    const outro = clip({ id: 'out-b', move: 'fadeOut', start: 7.5, end: 8, clipId: 'b' });
    const intro = clip({ id: 'in-b', move: 'fadeIn', start: 4, end: 4.5, clipId: 'b' });
    const split: MotionSegment[] = [
      cuts[0],
      { id: 'b', timelineStart: 4, timelineEnd: 6 },
      { id: 'b2', timelineStart: 6, timelineEnd: 8 },
      cuts[2],
    ];
    const repinned = repinMotionClips([outro, intro], cuts, split);
    expect(repinned.find((c) => c.id === 'out-b')?.clipId).toBe('b2');
    expect(repinned.find((c) => c.id === 'in-b')?.clipId).toBe('b');
  });
});

describe('shorter videos', () => {
  it('re-pins the outro and sets aside a block squeezed to a sliver', () => {
    const clips = [
      clip({ id: 'orbit', move: 'orbit', start: 5.5, end: 9 }),
      clip({ id: 'out', move: 'swingOut', start: 8.6, end: 10 }),
    ];
    const laid = layoutMotionClips(clips, video(7));
    expect(laid.map((c) => c.id)).toEqual(['out']);
    expect(laid[0].start).toBeCloseTo(5.6, 5);
    expect(laid[0].end).toBe(7);
    // Undoing the cut brings it back unchanged.
    expect(layoutMotionClips(clips, video(10)).map((c) => [c.id, c.start, c.end])).toEqual([
      ['orbit', 5.5, 8.6],
      ['out', 8.6, 10],
    ]);
  });
});

describe('adding clips', () => {
  it('adds an intro to the first clip and an outro to the last, once', () => {
    const clips = addIntroAndOutro(addIntroAndOutro([], cuts), cuts);
    expect(clips.map((c) => [c.move, c.clipId])).toEqual([
      ['tiltIn', 'a'],
      ['tiltAway', 'c'],
    ]);
  });

  it('adds a quick fade at a cut between clips', () => {
    const { clips } = addPinnedMove([], cuts, 'b', 'start');
    expect(clips[0].move).toBe('fadeIn');
    expect(clips[0].end - clips[0].start).toBeCloseTo(0.5, 5);
  });

  it('adds an intro near a clip start, an outro near its end, a push in between', () => {
    expect(addMotionAt([], cuts, 4.3).clips[0]).toMatchObject({ move: 'fadeIn', clipId: 'b' });
    expect(addMotionAt([], cuts, 7.8).clips[0]).toMatchObject({ move: 'fadeOut', clipId: 'b' });
    expect(addMotionAt([], cuts, 6).clips[0].move).toBe('slowPush');
  });

  it('fills the free space between neighbours with a move in between', () => {
    const base = addIntroAndOutro([], video(20));
    const { clips, id } = addMotionAt(base, video(20), 10);
    const added = clips.find((c) => c.id === id);
    expect(added?.start).toBeCloseTo(1.6, 5);
    expect(added?.end).toBeCloseTo(18.4, 5);
  });

  it('selects the block already under the playhead instead of adding', () => {
    const base = [clip({ id: 'x', start: 5, end: 9 })];
    const res = addMotionAt(base, video(20), 6);
    expect(res.clips).toHaveLength(1);
    expect(res.id).toBe('x');
  });

  it('adds nothing in an empty gap between clips', () => {
    expect(addMotionAt([], cuts, 8.5).id).toBeNull();
  });
});

describe('placeMotionClip', () => {
  it('keeps a moved block out of its neighbours', () => {
    const clips = [clip({ id: 'a', start: 0, end: 4 }), clip({ id: 'b', start: 6, end: 8 })];
    const moved = placeMotionClip(clips, video(20), 'b', 3, 5);
    const b = moved.find((c) => c.id === 'b');
    expect(b?.start).toBe(4);
    expect(b?.end).toBe(6);
  });

  it('keeps an intro on its clip when resized', () => {
    const clips = [clip({ id: 'a', move: 'tiltIn', start: 4, end: 5, clipId: 'b' })];
    const a = placeMotionClip(clips, cuts, 'a', 4.5, 6.5)[0];
    expect(a.start).toBe(4);
    expect(a.end).toBe(6);
  });
});

describe('rippleMotionClips', () => {
  // Deleting clip b (4–8) closes its 4s gap.
  const ripple = (clips: MotionClip[]) =>
    rippleMotionClips(clips, new Set(['b']), [{ start: 4, end: 8 }]);

  it("drops the intro and outro of a deleted clip and keeps the others'", () => {
    const kept = ripple([
      clip({ id: 'a-in', move: 'fadeIn', start: 0, end: 0.4, clipId: 'a' }),
      clip({ id: 'b-in', move: 'fadeIn', start: 4, end: 4.4, clipId: 'b' }),
      clip({ id: 'b-out', move: 'fadeOut', start: 7.6, end: 8, clipId: 'b' }),
      clip({ id: 'c-out', move: 'fadeOut', start: 11.6, end: 12, clipId: 'c' }),
    ]);
    expect(kept.map((c) => [c.id, c.start, c.end])).toEqual([
      ['a-in', 0, 0.4],
      ['c-out', 7.6, 8],
    ]);
  });

  it('pulls a later move back by the deleted length', () => {
    const [push] = ripple([clip({ start: 9.5, end: 11 })]);
    expect([push.start, push.end]).toEqual([5.5, 7]);
  });

  it('shortens a move that ran into the deleted clip, and drops one inside it', () => {
    const kept = ripple([
      clip({ id: 'across', start: 3, end: 10 }),
      clip({ id: 'inside', start: 5, end: 7 }),
    ]);
    expect(kept.map((c) => [c.id, c.start, c.end])).toEqual([['across', 3, 6]]);
  });
});

describe('editing a clip', () => {
  it('changing the move keeps timing and drops customization', () => {
    const c = {
      ...clip({ move: 'tiltIn', end: 2 }),
      custom: getClipPoses(clip({ move: 'tiltIn' })),
    };
    const next = setClipMove(c, 'rise');
    expect(next.move).toBe('rise');
    expect(next.custom).toBeUndefined();
    expect(next.end).toBe(2);
  });

  it('swap reverses the start and end poses', () => {
    const c = clip({ move: 'tiltIn', end: 2 });
    const swapped = swapClipPoses(c);
    expect(swapped.custom?.from).toEqual(getClipPoses(c).to);
    expect(swapped.custom?.to).toEqual(getClipPoses(c).from);
  });
});

describe('normalizeMotionClips', () => {
  it('drops anything invalid read from disk and keeps the clip a block is pinned to', () => {
    expect(normalizeMotionClips(undefined)).toEqual([]);
    const out = normalizeMotionClips([
      {
        id: 'a',
        move: 'tiltIn',
        start: 0,
        end: 2,
        amount: 'default',
        feel: 'smooth',
        clipId: 'seg-1',
      },
      { id: 'b', move: 'nope', start: 0, end: 2 },
      { id: 'c', move: 'slowPush', start: 5, end: 4 },
    ]);
    expect(out.map((c) => [c.id, c.clipId])).toEqual([['a', 'seg-1']]);
  });
});

describe('move library', () => {
  const groupOf = (move: MotionClip['move']) => getMotionGroup({ move });

  it('every intro settles at rest, every outro starts from rest', () => {
    for (const move of MOTION_MOVE_IDS) {
      const c = clip({ move, start: 0, end: 4 });
      const group = groupOf(move);
      if (group === 'start') {
        expect(isIdentityMotion(resolveMotionAt([c], video(10), 4)), move).toBe(true);
      }
      if (group === 'end') {
        expect(
          isIdentityMotion(resolveMotionAt([{ ...c, start: 6, end: 10 }], video(10), 6)),
          move,
        ).toBe(true);
      }
    }
  });

  it('every move in between starts from rest so it chains without a jump', () => {
    for (const move of MOTION_MOVE_IDS.filter((m) => groupOf(m) === 'during')) {
      const c = clip({ move, start: 2, end: 8 });
      expect(isIdentityMotion(resolveMotionAt([c], video(10), 2)), move).toBe(true);
    }
  });

  it('swaying moves move in the middle and come back to rest at the end', () => {
    for (const move of ['orbit', 'breathe', 'float'] as const) {
      const c = clip({ move, start: 0, end: 12 });
      expect(isIdentityMotion(resolveMotionAt([c], video(12), 4.3)), move).toBe(false);
      expect(isIdentityMotion(resolveMotionAt([c], video(12), 12)), move).toBe(true);
    }
  });

  it('subtle moves stay subtle', () => {
    const lift = resolveMotionAt([clip({ move: 'lift', end: 2 })], video(10), 0);
    expect(Math.abs(lift.y)).toBeLessThan(0.05);
    expect(lift.scale).toBeGreaterThan(0.95);
    const breathe = clip({ move: 'breathe', start: 0, end: 12 });
    for (let t = 0; t <= 12; t += 0.5) {
      expect(Math.abs(resolveMotionAt([breathe], video(12), t).scale - 1)).toBeLessThan(0.03);
    }
  });

  it('every move belongs to a tone for grouping in the menu', () => {
    for (const move of MOTION_MOVE_IDS) {
      expect(['subtle', 'classic', 'cinematic']).toContain(MOTION_MOVES[move].tone);
    }
  });
});
