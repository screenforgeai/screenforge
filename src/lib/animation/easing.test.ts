import { describe, expect, it } from 'vitest';
import { applyEasing, EASE_PRESETS, DEFAULT_EASING } from './easing';
import type { Easing } from './types';

const preset = (name: (typeof EASE_PRESETS)[number], intensity = 0.5): Easing => ({
  kind: 'preset',
  name,
  intensity,
});

describe('applyEasing', () => {
  it('starts at 0 and ends at 1 for every preset except hold', () => {
    for (const name of EASE_PRESETS) {
      const ease = preset(name);
      expect(applyEasing(ease, 0)).toBeCloseTo(0, 5);
      expect(applyEasing(ease, 1)).toBeCloseTo(1, 5);
    }
  });

  it('clamps progress outside 0..1', () => {
    expect(applyEasing(DEFAULT_EASING, -0.5)).toBe(0);
    expect(applyEasing(DEFAULT_EASING, 1.5)).toBe(1);
  });

  it('linear returns progress unchanged', () => {
    expect(applyEasing(preset('linear'), 0.3)).toBeCloseTo(0.3, 5);
  });

  it('hold stays at the start value until the next key', () => {
    expect(applyEasing(preset('hold'), 0.99)).toBe(0);
    expect(applyEasing(preset('hold'), 1)).toBe(1);
  });

  it('smooth is symmetric around the midpoint', () => {
    const ease = preset('smooth');
    expect(applyEasing(ease, 0.5)).toBeCloseTo(0.5, 5);
    expect(applyEasing(ease, 0.25)).toBeCloseTo(1 - applyEasing(ease, 0.75), 5);
  });

  it('slow down moves fast first, speed up moves slow first', () => {
    expect(applyEasing(preset('slowDown'), 0.25)).toBeGreaterThan(0.25);
    expect(applyEasing(preset('speedUp'), 0.25)).toBeLessThan(0.25);
  });

  it('higher intensity makes slow down more pronounced', () => {
    expect(applyEasing(preset('slowDown', 1), 0.2)).toBeGreaterThan(
      applyEasing(preset('slowDown', 0), 0.2),
    );
  });

  it('overshoot goes past the target before settling', () => {
    const ease = preset('overshoot');
    const peak = Math.max(...Array.from({ length: 50 }, (_, i) => applyEasing(ease, i / 49)));
    expect(peak).toBeGreaterThan(1);
  });

  it('bounce never goes past the target', () => {
    const ease = preset('bounce');
    for (let i = 0; i <= 100; i++) {
      expect(applyEasing(ease, i / 100)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('evaluates a CSS-style cubic bezier', () => {
    const ease: Easing = { kind: 'bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
    // CSS `ease` at x=0.5 is ~0.8024
    expect(applyEasing(ease, 0.5)).toBeCloseTo(0.8024, 3);
    const linear: Easing = { kind: 'bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
    expect(applyEasing(linear, 0.37)).toBeCloseTo(0.37, 4);
  });
});
