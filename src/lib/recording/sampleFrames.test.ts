import { describe, expect, it } from 'vitest';
import { distinctSeekTimes } from './sampleFrames';

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
