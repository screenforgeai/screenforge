import { describe, expect, it } from 'vitest';
import { distinctFrameCount, distinctSeekTimes } from './sampleFrames';

describe('distinctSeekTimes', () => {
  it('keeps each position inside the video once', () => {
    expect(distinctSeekTimes([0.5, 1.5, 2.5], 10)).toEqual([0.5, 1.5, 2.5]);
  });

  it("doesn't count the same last frame over and over in a short video", () => {
    // The recording said 20s, the file holds 2s: most seeks clamp to its end.
    const times = Array.from({ length: 20 }, (_, i) => i + 0.5);
    const seeks = distinctSeekTimes(times, 2);
    expect(seeks).toEqual([0.5, 1.5, 1.95]);
    expect(seeks.length).toBeLessThan(10);
  });

  it('treats seeks under a millisecond apart as one', () => {
    expect(distinctSeekTimes([1, 1.0001, 1.002], 10)).toEqual([1, 1.002]);
  });

  it('leaves times alone when the duration is unknown', () => {
    expect(distinctSeekTimes([3, 1], Infinity)).toEqual([3, 1]);
    expect(distinctSeekTimes([3, 1], NaN)).toEqual([3, 1]);
  });
});

describe('distinctFrameCount', () => {
  const frame = (fill: number, width = 4, height = 2) => ({
    data: new Uint8ClampedArray(width * height * 4).fill(fill),
    width,
    height,
  });

  it('counts the same decoded picture once, however many seeks reached it', () => {
    // A low frame rate: 20 seeks, 3 pictures.
    const frames = Array.from({ length: 20 }, (_, i) => frame([10, 20, 30][i % 3] ?? 0));
    expect(distinctFrameCount(frames)).toBe(3);
  });

  it('tells pictures apart by a single changed pixel', () => {
    const a = frame(50);
    const b = frame(50);
    b.data[17] = 51;
    expect(distinctFrameCount([a, b])).toBe(2);
  });

  it('never matches frames of different sizes', () => {
    expect(distinctFrameCount([frame(0, 4, 2), frame(0, 2, 4)])).toBe(2);
  });
});
