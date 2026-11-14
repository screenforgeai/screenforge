import { describe, expect, it } from 'vitest';
import {
  CLICK_EFFECT_DURATION,
  createCursorPath,
  findClicksInWindow,
  getClickParticles,
  getPulse,
  getSpotlightRadius,
  getTrailParticles,
  normalizeCursorClickEffect,
  normalizeCursorEffect,
} from './effects';

describe('click particles', () => {
  it('gives the same particles for the same click and time, so preview and export match', () => {
    expect(getClickParticles('sparkle', 7, 0.2, 1)).toEqual(
      getClickParticles('sparkle', 7, 0.2, 1),
    );
    expect(getClickParticles('confetti', 3, 0.5, 2)).toEqual(
      getClickParticles('confetti', 3, 0.5, 2),
    );
  });

  it('scatters each click differently', () => {
    expect(getClickParticles('sparkle', 1, 0.2, 1)).not.toEqual(
      getClickParticles('sparkle', 2, 0.2, 1),
    );
  });

  it('bursts sparkles outward and fades them out', () => {
    const early = getClickParticles('sparkle', 1, 0.05, 1);
    const late = getClickParticles('sparkle', 1, 0.5, 1);
    expect(early).toHaveLength(10);
    const spread = (ps: typeof early) =>
      ps.reduce((sum, p) => sum + Math.hypot(p.x, p.y), 0) / ps.length;
    expect(spread(late)).toBeGreaterThan(spread(early));
    expect(Math.max(...late.map((p) => p.alpha))).toBeLessThan(
      Math.max(...early.map((p) => p.alpha)),
    );
  });

  it('lets confetti fall under gravity', () => {
    const rising = getClickParticles('confetti', 4, 0.1, 1);
    const falling = getClickParticles('confetti', 4, 0.9, 1);
    const meanY = (ps: typeof rising) => ps.reduce((sum, p) => sum + p.y, 0) / ps.length;
    expect(meanY(falling)).toBeGreaterThan(meanY(rising));
  });

  it('draws nothing once an effect has finished', () => {
    expect(getClickParticles('sparkle', 1, CLICK_EFFECT_DURATION.sparkle + 0.01, 1)).toEqual([]);
    expect(getPulse(CLICK_EFFECT_DURATION.pulse + 0.01, 1)).toBeNull();
    expect(getPulse(-0.01, 1)).toBeNull();
  });

  it('scales with the cursor size', () => {
    const small = getClickParticles('sparkle', 1, 0.3, 1);
    const big = getClickParticles('sparkle', 1, 0.3, 2);
    expect(big[0].x).toBeCloseTo(small[0].x * 2);
    expect(getPulse(0.2, 2)?.radius).toBeCloseTo((getPulse(0.2, 1)?.radius ?? 0) * 2);
  });
});

describe('finding recent clicks', () => {
  const clicks = [{ t: 1 }, { t: 2 }, { t: 2.5 }, { t: 4 }];

  it('returns clicks inside the window, oldest first', () => {
    expect(findClicksInWindow(clicks, 2.6, 0.7)).toEqual([1, 2]);
    expect(findClicksInWindow(clicks, 0.5, 1)).toEqual([]);
    expect(findClicksInWindow(clicks, 4, 0)).toEqual([3]);
  });
});

describe('glitter trail', () => {
  it('leaves no sparkles while the cursor rests', () => {
    expect(getTrailParticles(3, () => ({ x: 100, y: 100 }), 1)).toEqual([]);
  });

  it('sprinkles sparkles behind a moving cursor, the same way every time', () => {
    const moving = (s: number) => ({ x: s * 400, y: 200 });
    const first = getTrailParticles(3, moving, 1);
    expect(first.length).toBeGreaterThan(5);
    expect(getTrailParticles(3, moving, 1)).toEqual(first);
    // Every sparkle sits behind (left of) the cursor's current position.
    expect(Math.max(...first.map((p) => p.x))).toBeLessThanOrEqual(3 * 400 + 12);
  });
});

describe('spotlight', () => {
  it('tightens briefly after a click and then relaxes', () => {
    const resting = getSpotlightRadius(1, null);
    expect(getSpotlightRadius(1, 0.1)).toBeLessThan(resting);
    expect(getSpotlightRadius(1, 2)).toBeCloseTo(resting);
    expect(getSpotlightRadius(2, null)).toBeCloseTo(resting * 2);
  });
});

describe('saved effect values', () => {
  it('keeps known values and falls back for anything else', () => {
    expect(normalizeCursorClickEffect('confetti')).toBe('confetti');
    expect(normalizeCursorClickEffect('fireworks')).toBe('none');
    expect(normalizeCursorEffect('spotlight')).toBe('spotlight');
    expect(normalizeCursorEffect(undefined)).toBe('none');
  });
});

describe('drawn cursor path (for the glitter trail)', () => {
  it('returns where the drawn cursor was, interpolated between frames', () => {
    const path = createCursorPath();
    path.record(1, 0.1, 0.2);
    path.record(1.1, 0.3, 0.4);
    const mid = path.at(1.05);
    expect(mid?.nx).toBeCloseTo(0.2);
    expect(mid?.ny).toBeCloseTo(0.3);
    expect(path.at(1)).toEqual({ nx: 0.1, ny: 0.2 });
  });

  it('knows nothing before it started recording or after the latest frame', () => {
    const path = createCursorPath();
    path.record(2, 0.5, 0.5);
    path.record(2.1, 0.6, 0.5);
    expect(path.at(1.99)).toBeNull();
    expect(path.at(2.2)).toBeNull();
  });

  it('forgets positions older than it needs', () => {
    const path = createCursorPath(1);
    path.record(0, 0, 0);
    path.record(0.5, 0.5, 0);
    path.record(1.6, 1, 0);
    expect(path.at(0.2)).toBeNull();
    expect(path.at(1)?.nx).toBeCloseTo(0.5 + (0.5 * 0.5) / 1.1);
  });

  it('starts over when time jumps backwards (a seek)', () => {
    const path = createCursorPath();
    path.record(5, 0.9, 0.9);
    path.record(5.1, 0.9, 0.9);
    path.record(1, 0.1, 0.1);
    expect(path.at(5)).toBeNull();
    expect(path.at(1)).toEqual({ nx: 0.1, ny: 0.1 });
  });

  it('feeds the trail only once the drawn cursor has actually moved', () => {
    const path = createCursorPath();
    for (let i = 0; i <= 60; i++) {
      // The drawn cursor sits still for half a second, then moves.
      path.record(i / 60, i < 30 ? 0.5 : 0.5 + (i - 30) / 60, 0.5);
    }
    const toCanvas = (s: number) => {
      const p = path.at(s);
      return p ? { x: p.nx * 1000, y: p.ny * 1000 } : null;
    };
    const sparkles = getTrailParticles(1, toCanvas, 1);
    expect(sparkles.length).toBeGreaterThan(0);
    // Nothing is born ahead of where the drawn cursor is now.
    expect(Math.max(...sparkles.map((p) => p.x))).toBeLessThanOrEqual(1000 + 12);
  });
});
