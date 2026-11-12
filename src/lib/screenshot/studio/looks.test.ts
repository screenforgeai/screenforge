import { describe, expect, it } from 'vitest';
import {
  STUDIO_LOOKS,
  defaultLightHandle,
  getStudioLook,
  imageStats,
  keyLightFromHandle,
  pickLookId,
  screenGainFor,
} from './looks';

/** RGBA pixels: `count` pixels of one colour. */
const pixels = (rgb: [number, number, number], count: number) => {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    data.set([...rgb, 255], i * 4);
  }
  return data;
};

const mix = (...parts: Uint8ClampedArray[]) => {
  const out = new Uint8ClampedArray(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

describe('imageStats', () => {
  it('measures brightness, average colourfulness and the share of strong accents', () => {
    const stats = imageStats(mix(pixels([255, 255, 255], 90), pixels([230, 30, 60], 10)));
    expect(stats.lum).toBeGreaterThan(0.8);
    expect(stats.vivid).toBeCloseTo(0.1, 5);
    expect(stats.sat).toBeGreaterThan(0.05);
  });

  it('treats an empty image as mid grey rather than failing', () => {
    expect(imageStats(new Uint8ClampedArray(0))).toEqual({ lum: 0.5, sat: 0, vivid: 0 });
  });
});

describe('pickLookId', () => {
  it('sets a light screenshot on a dark backdrop', () => {
    expect(pickLookId({ lum: 0.85, sat: 0.05, vivid: 0 })).toBe('night-glow');
  });

  it('films a dark screenshot with colour accents through the macro lens', () => {
    expect(pickLookId({ lum: 0.1, sat: 0.08, vivid: 0.02 })).toBe('macro');
  });

  it('puts a dark, plain screenshot on light paper', () => {
    expect(pickLookId({ lum: 0.1, sat: 0.02, vivid: 0.001 })).toBe('paper-studio');
  });

  it('keeps a colourful mid-tone screenshot on a neutral stage, a muted one on a warm backdrop', () => {
    expect(pickLookId({ lum: 0.5, sat: 0.3, vivid: 0.2 })).toBe('graphite-stage');
    expect(pickLookId({ lum: 0.5, sat: 0.1, vivid: 0 })).toBe('warm-sunset');
  });

  it('only ever picks a look that exists', () => {
    const ids = new Set(STUDIO_LOOKS.map((look) => look.id));
    for (const lum of [0.05, 0.4, 0.9]) {
      for (const vivid of [0, 0.5]) {
        expect(ids.has(pickLookId({ lum, sat: vivid, vivid }))).toBe(true);
      }
    }
  });
});

describe('screenGainFor', () => {
  it('keeps a dark screen at full brightness', () => {
    expect(screenGainFor('auto', 0.1)).toBe(1);
  });

  it('exposes a white screen down, the way a photo of a display reads light grey', () => {
    expect(screenGainFor('auto', 0.95)).toBeCloseTo(0.7, 5);
  });

  it('passes a fixed gain through unchanged', () => {
    expect(screenGainFor(0.8, 0.95)).toBe(0.8);
  });
});

describe('light handle', () => {
  it('starts where each look already puts its key light', () => {
    for (const look of STUDIO_LOOKS) {
      const key = keyLightFromHandle(defaultLightHandle(look.settings.envRot));
      expect(key.envRot).toBeCloseTo(look.settings.envRot, 5);
      expect(key.height).toBeCloseTo(4.2, 5);
    }
  });

  it('moves the light to the right when the handle moves right, and higher when it moves up', () => {
    const left = keyLightFromHandle({ x: 0.2, y: 0.18 });
    const right = keyLightFromHandle({ x: 0.8, y: 0.18 });
    expect(right.side).toBeGreaterThan(left.side);
    expect(keyLightFromHandle({ x: 0.5, y: 0.05 }).height).toBeGreaterThan(
      keyLightFromHandle({ x: 0.5, y: 0.4 }).height,
    );
  });

  it('keeps the reflections turned within the studio when the handle goes past the edge', () => {
    expect(keyLightFromHandle({ x: -1, y: 0.2 }).envRot).toBe(0);
    expect(keyLightFromHandle({ x: 2, y: 0.2 }).envRot).toBe(180);
  });
});

describe('getStudioLook', () => {
  it('returns null for the flat (no look) id and unknown ids', () => {
    expect(getStudioLook(null)).toBeNull();
    expect(getStudioLook('nope')).toBeNull();
  });

  it('gives every look the full set of settings', () => {
    const macro = getStudioLook('macro');
    // Macro starts straight-on; turning the camera brings the angle.
    expect(macro?.settings.lean).toBe(0);
    expect(macro?.settings.camera).toBe('straight');
    expect(macro?.settings.dof).toBe(true);
    // Graded like the lab's macro even straight-on: the top of the screen sinks into shadow, and
    // the glass barely mirrors the lights in front of it (straight-on that reads as a grey haze).
    expect(macro?.settings).toMatchObject({
      reflect: 0.08,
      screenFade: 0.6,
      fadeAngle: 90,
      fadeSoft: 0.65,
      vignette: 0.7,
      fringe: 0.3,
    });
    expect(getStudioLook('night-glow')?.settings.lean).toBe(0);
  });
});
