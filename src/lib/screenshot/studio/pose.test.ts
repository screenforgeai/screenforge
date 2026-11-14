import { describe, expect, it } from 'vitest';
import {
  MAX_DEPTH,
  MAX_OFFSET,
  MAX_ORBIT_DOWN,
  MAX_ORBIT_UP,
  MAX_ORBIT_X,
  MAX_LIGHT_POWER,
  MAX_ZOOM,
  MIN_DEPTH,
  MIN_LIGHT_POWER,
  MIN_ZOOM,
  clampOffset,
  depthAfterWheel,
  focusRangeAfterWheel,
  lightPowerAfterWheel,
  orbitAfterDrag,
  zoomAfterWheel,
} from './pose';

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

describe('orbitAfterDrag', () => {
  it('turns the camera left/right with a sideways drag and up/down with a vertical one', () => {
    const turned = orbitAfterDrag({ x: 0, y: 0 }, -0.25, 0.25);
    expect(turned.x).toBeGreaterThan(0);
    expect(turned.y).toBeGreaterThan(0);
  });

  it('keeps the screenshot facing the camera: the turn stops short of its edge, and of going under it', () => {
    expect(orbitAfterDrag({ x: 0, y: 0 }, -5, 0).x).toBe(MAX_ORBIT_X);
    expect(orbitAfterDrag({ x: 0, y: 0 }, 5, 0).x).toBe(-MAX_ORBIT_X);
    expect(orbitAfterDrag({ x: 0, y: 0 }, 0, 5).y).toBe(MAX_ORBIT_UP);
    expect(orbitAfterDrag({ x: 0, y: 0 }, 0, -5).y).toBe(-MAX_ORBIT_DOWN);
    expect(MAX_ORBIT_X).toBeLessThan(Math.PI / 2);
  });
});

describe('zoomAfterWheel', () => {
  it('moves the camera in on scroll up and out on scroll down', () => {
    expect(zoomAfterWheel(1, -100)).toBeLessThan(1);
    expect(zoomAfterWheel(1, 100)).toBeGreaterThan(1);
  });

  it('round-trips and stays within its range', () => {
    expect(zoomAfterWheel(zoomAfterWheel(1, -240), 240)).toBeCloseTo(1, 6);
    expect(zoomAfterWheel(1, -100000)).toBe(MIN_ZOOM);
    expect(zoomAfterWheel(1, 100000)).toBe(MAX_ZOOM);
  });
});

describe('focusRangeAfterWheel', () => {
  it('widens the sharp area on scroll up and narrows it on scroll down, within 0..1', () => {
    expect(focusRangeAfterWheel(0.2, -100)).toBeGreaterThan(0.2);
    expect(focusRangeAfterWheel(0.2, 100)).toBeLessThan(0.2);
    expect(focusRangeAfterWheel(0, 1000)).toBe(0);
    expect(focusRangeAfterWheel(1, -1000)).toBe(1);
  });
});

describe('lightPowerAfterWheel', () => {
  it('brightens on scroll up and dims on scroll down, within its range', () => {
    expect(lightPowerAfterWheel(1, -100)).toBeGreaterThan(1);
    expect(lightPowerAfterWheel(1, 100)).toBeLessThan(1);
    expect(lightPowerAfterWheel(1, -100000)).toBe(MAX_LIGHT_POWER);
    expect(lightPowerAfterWheel(1, 100000)).toBe(MIN_LIGHT_POWER);
  });
});
