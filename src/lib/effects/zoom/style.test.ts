import { describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM_STYLE } from '../../../store/defaults';
import type { ZoomClip } from '../../../types/timeline';
import { defaultZoomClip } from './analyze';
import {
  applyStylePresetZoom,
  applyZoomIntensity,
  applyZoomStyle,
  getZoomEasingProfile,
  migrateLegacyAutoZoomClips,
  normalizeZoomStyle,
  prepareDetectedZoomClips,
  rescaleAutoZoomClips,
  ZOOM_INTENSITY_MAX,
  ZOOM_INTENSITY_MIN,
} from './style';

const autoClip = (id: string, scale: number, extra: Partial<ZoomClip> = {}): ZoomClip => ({
  ...defaultZoomClip(id, 0, 3, 0.5, 0.5, scale),
  autoScale: scale,
  ...extra,
});

describe('normalizeZoomStyle', () => {
  it('fills defaults that reproduce the previous behaviour', () => {
    expect(DEFAULT_ZOOM_STYLE).toEqual({ intensity: 1, easing: 'standard' });
    expect(normalizeZoomStyle(undefined)).toEqual(DEFAULT_ZOOM_STYLE);
    expect(normalizeZoomStyle(null)).toEqual(DEFAULT_ZOOM_STYLE);
    expect(normalizeZoomStyle({})).toEqual(DEFAULT_ZOOM_STYLE);
  });

  it('keeps valid values and clamps or replaces invalid ones', () => {
    expect(normalizeZoomStyle({ intensity: 0.7, easing: 'gentle' })).toEqual({
      intensity: 0.7,
      easing: 'gentle',
    });
    expect(normalizeZoomStyle({ intensity: 9, easing: 'bouncy' })).toEqual({
      intensity: ZOOM_INTENSITY_MAX,
      easing: 'standard',
    });
    expect(normalizeZoomStyle({ intensity: -1, easing: 'snappy' })).toEqual({
      intensity: ZOOM_INTENSITY_MIN,
      easing: 'snappy',
    });
    expect(normalizeZoomStyle({ intensity: Number.NaN })).toEqual(DEFAULT_ZOOM_STYLE);
  });
});

describe('applyZoomIntensity', () => {
  it('is the identity at 100%', () => {
    for (const scale of [1.4, 1.8, 2, 2.3, 2.8]) {
      expect(applyZoomIntensity(scale, 1)).toBe(scale);
    }
  });

  it('scales the zoom depth above 1x', () => {
    expect(applyZoomIntensity(2, 0.5)).toBeCloseTo(1.5, 5);
    expect(applyZoomIntensity(2, 1.5)).toBeCloseTo(2.5, 5);
    expect(applyZoomIntensity(2.4, 0.75)).toBeCloseTo(2.05, 5);
  });

  it('stays inside the zoom level slider range', () => {
    expect(applyZoomIntensity(1.1, 0.5)).toBeGreaterThanOrEqual(1.1);
    expect(applyZoomIntensity(3.5, 1.5)).toBeLessThanOrEqual(4);
  });
});

describe('rescaleAutoZoomClips', () => {
  it('rescales auto-detected clips the user has not touched', () => {
    const clips = [autoClip('zoom-auto-0', 2), autoClip('zoom-auto-1', 2.4)];

    const softer = rescaleAutoZoomClips(clips, 1, 0.5);
    expect(softer.map((c) => c.scale)).toEqual([1.5, 1.7]);

    // Moving back restores the analysed scale exactly.
    const restored = rescaleAutoZoomClips(softer, 0.5, 1);
    expect(restored.map((c) => c.scale)).toEqual([2, 2.4]);
  });

  it('leaves hand-tuned auto clips and user-added clips alone', () => {
    const tuned = autoClip('zoom-auto-0', 2, { scale: 3.1 });
    const added = defaultZoomClip('zoom-123', 4, 6, 0.5, 0.5, 2);

    const next = rescaleAutoZoomClips([tuned, added], 1, 1.5);
    expect(next[0].scale).toBe(3.1);
    expect(next[1].scale).toBe(2);
  });

  it('keeps tracking untouched clips across a chain of slider steps', () => {
    let clips = [autoClip('zoom-auto-0', 2.2)];
    let intensity = 1;
    for (const step of [0.95, 0.9, 0.85, 0.6, 1.25, 1.5, 1]) {
      clips = rescaleAutoZoomClips(clips, intensity, step);
      intensity = step;
    }
    expect(clips[0].scale).toBe(2.2);
  });

  it('returns the same array when nothing changes', () => {
    const clips = [autoClip('zoom-auto-0', 2)];
    expect(rescaleAutoZoomClips(clips, 1, 1)).toBe(clips);
  });
});

describe('prepareDetectedZoomClips', () => {
  it('applies the project intensity and easing to freshly analysed clips', () => {
    const clips = [autoClip('zoom-auto-0', 2)];

    const [clip] = prepareDetectedZoomClips(clips, { intensity: 0.5, easing: 'gentle' });
    expect(clip.scale).toBe(1.5);
    expect(clip.autoScale).toBe(2);
    expect(clip.easing).toBe('gentle');
  });

  it('changes nothing at the default style', () => {
    const clips = [autoClip('zoom-auto-0', 2)];
    expect(prepareDetectedZoomClips(clips, DEFAULT_ZOOM_STYLE)).toEqual(clips);
  });
});

describe('applyZoomStyle', () => {
  it('rescales untouched auto clips when the intensity changes', () => {
    const state = {
      zoomStyle: DEFAULT_ZOOM_STYLE,
      zoomClips: [autoClip('zoom-auto-0', 2), autoClip('zoom-auto-1', 2, { scale: 2.6 })],
    };

    const next = applyZoomStyle(state, { intensity: 1.5 });
    expect(next.zoomStyle).toEqual({ intensity: 1.5, easing: 'standard' });
    expect(next.zoomClips.map((c) => c.scale)).toEqual([2.5, 2.6]);
  });

  it('sets the easing on every zoom clip, including user-added ones', () => {
    const state = {
      zoomStyle: DEFAULT_ZOOM_STYLE,
      zoomClips: [autoClip('zoom-auto-0', 2), defaultZoomClip('zoom-9', 4, 6)],
    };

    const next = applyZoomStyle(state, { easing: 'snappy' });
    expect(next.zoomStyle).toEqual({ intensity: 1, easing: 'snappy' });
    expect(next.zoomClips.map((c) => c.easing)).toEqual(['snappy', 'snappy']);
    expect(next.zoomClips.map((c) => c.scale)).toEqual([2, 2]);
  });
});

describe('applyStylePresetZoom', () => {
  const state = {
    zoomStyle: DEFAULT_ZOOM_STYLE,
    zoomClips: [autoClip('zoom-auto-0', 2)],
  };

  it('applies the zoom style saved in a preset', () => {
    const patch = applyStylePresetZoom(state, { zoomStyle: { intensity: 0.5, easing: 'gentle' } });
    expect(patch.zoomStyle).toEqual({ intensity: 0.5, easing: 'gentle' });
    expect(patch.zoomClips?.[0]).toMatchObject({ scale: 1.5, easing: 'gentle' });
  });

  it('normalizes a damaged zoom style in a preset', () => {
    const patch = applyStylePresetZoom(state, {
      zoomStyle: { intensity: 'lots', easing: 'snappy' } as never,
    });
    expect(patch.zoomStyle).toEqual({ intensity: 1, easing: 'snappy' });
  });

  it('leaves zoom alone for presets saved before zoom style existed', () => {
    expect(applyStylePresetZoom(state, {})).toEqual({});
  });
});

describe('migrateLegacyAutoZoomClips', () => {
  it('records the analysed scale of auto-detected clips from older projects', () => {
    const legacyAuto = defaultZoomClip('zoom-auto-3', 0, 3, 0.5, 0.5, 2.3);
    const manual = defaultZoomClip('zoom-171', 4, 6, 0.5, 0.5, 2.3);

    const [auto, user] = migrateLegacyAutoZoomClips([legacyAuto, manual]);
    expect(auto.autoScale).toBe(2.3);
    expect(auto.scale).toBe(2.3);
    expect(user.autoScale).toBeUndefined();
  });

  it('keeps an existing analysed scale', () => {
    const clip = autoClip('zoom-auto-0', 2, { scale: 1.5 });
    expect(migrateLegacyAutoZoomClips([clip])[0].autoScale).toBe(2);
  });
});

describe('getZoomEasingProfile', () => {
  it('reproduces the previous quadratic ease for "standard"', () => {
    const profile = getZoomEasingProfile('standard');
    expect(profile.rampScale).toBe(1);
    expect(profile.panHalflifeScale).toBe(1);
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const legacy = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      expect(profile.ease(t)).toBeCloseTo(legacy, 10);
    }
  });

  it('falls back to "standard" for unknown values', () => {
    expect(getZoomEasingProfile(undefined)).toBe(getZoomEasingProfile('standard'));
    expect(getZoomEasingProfile('wobbly')).toBe(getZoomEasingProfile('standard'));
  });

  it('makes "gentle" slower and softer and "snappy" faster', () => {
    const gentle = getZoomEasingProfile('gentle');
    const snappy = getZoomEasingProfile('snappy');

    expect(gentle.rampScale).toBeGreaterThan(1);
    expect(gentle.panHalflifeScale).toBeGreaterThan(1);
    expect(snappy.rampScale).toBeLessThan(1);
    expect(snappy.panHalflifeScale).toBeLessThan(1);

    for (const profile of [gentle, snappy]) {
      expect(profile.ease(0)).toBe(0);
      expect(profile.ease(1)).toBeCloseTo(1, 10);
      expect(profile.ease(0.5)).toBeCloseTo(0.5, 10);
    }
  });
});
