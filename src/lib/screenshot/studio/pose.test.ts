import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, MAX_OFFSET, MIN_DEPTH, clampOffset, depthAfterWheel } from './pose';

describe('depthAfterWheel', () => {
  it('brings the screenshot closer on scroll up (or pinch out), pushes it back on scroll down', () => {
    expect(depthAfterWheel(0, -100)).toBeGreaterThan(0);
    expect(depthAfterWheel(0, 100)).toBeLessThan(0);
  });

  it('feels the same at any depth: equal scrolls scale the distance to the camera equally', () => {
    const distance = (depth: number) => 1 - depth;
    const near = depthAfterWheel(0.5, 100);
    const far = depthAfterWheel(-1, 100);
    expect(distance(near) / distance(0.5)).toBeCloseTo(distance(far) / distance(-1), 6);
  });

  it('round-trips: scrolling back by the same amount returns to where it was', () => {
    expect(depthAfterWheel(depthAfterWheel(0.3, -240), 240)).toBeCloseTo(0.3, 6);
  });

  it('never reaches the camera, and never disappears into the distance', () => {
    expect(depthAfterWheel(0, -100000)).toBe(MAX_DEPTH);
    expect(depthAfterWheel(0, 100000)).toBe(MIN_DEPTH);
    expect(MAX_DEPTH).toBeLessThan(1);
  });
});

describe('clampOffset', () => {
  it('lets the screenshot go well past the frame edge', () => {
    expect(clampOffset({ x: 1.2, y: -1.2 })).toEqual({ x: 1.2, y: -1.2 });
  });

  it('keeps it within reach so it can always be dragged back', () => {
    expect(clampOffset({ x: 9, y: -9 })).toEqual({ x: MAX_OFFSET, y: -MAX_OFFSET });
  });
});
