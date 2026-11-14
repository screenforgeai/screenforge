import { describe, expect, it } from 'vitest';
import { autoFocusPoint } from './focus';

/** A w×h RGBA image of one grey, with a block of black-and-white stripes (fine detail). */
const image = (
  w: number,
  h: number,
  detail?: { x0: number; y0: number; x1: number; y1: number },
) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = detail && x >= detail.x0 && x < detail.x1 && y >= detail.y0 && y < detail.y1;
      const v = inside ? (x % 2 === 0 ? 0 : 255) : 128;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }
  }
  return data;
};

describe('autoFocusPoint', () => {
  it('focuses the centre of a plain image', () => {
    expect(autoFocusPoint(image(96, 60), 96, 60)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('finds the most detailed part, such as a block of text', () => {
    const point = autoFocusPoint(image(96, 60, { x0: 8, y0: 6, x1: 30, y1: 20 }), 96, 60);
    expect(point.x).toBeLessThan(0.35);
    expect(point.y).toBeLessThan(0.35);
  });

  it('prefers detail nearer the centre when two areas are equally busy', () => {
    const w = 96,
      h = 60;
    const data = image(w, h, { x0: 2, y0: 2, x1: 14, y1: 12 });
    const centre = image(w, h, { x0: 42, y0: 24, x1: 54, y1: 34 });
    for (let i = 0; i < data.length; i += 4) {
      if (centre[i] !== 128) {
        data.set(centre.subarray(i, i + 4), i);
      }
    }
    const point = autoFocusPoint(data, w, h);
    expect(Math.abs(point.x - 0.5)).toBeLessThan(0.15);
    expect(Math.abs(point.y - 0.5)).toBeLessThan(0.15);
  });
});
