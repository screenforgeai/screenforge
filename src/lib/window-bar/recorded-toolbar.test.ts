import { describe, expect, it } from 'vitest';
import {
  cropRectForToolbar,
  detectRecordedToolbar,
  needsToolbarRedetect,
  stableBandHeight,
  strongestHorizontalLine,
  toolbarSampleTimes,
  type RgbaFrame,
} from './recorded-toolbar';

const W = 400;
const H = 600;

/**
 * A browser window: a still toolbar `toolbar` rows tall with a dark border
 * row, then `stillPage` rows of page that never change (a heading), then a
 * page that changes per frame.
 */
function frame(seed: number, toolbar = 80, border = true, stillPage = 0): RgbaFrame {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = seed * 9973 + 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 255;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let v: number;
      if (y < toolbar - 1) {
        v = y < 40 ? 222 : 240;
      } // tabs, then the address row
      else if (y === toolbar - 1) {
        v = border ? 190 : 240;
      } else if (y < toolbar + stillPage) {
        v = 252;
      } else {
        v = rand();
      }
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

const frames = Array.from({ length: 20 }, (_, i) => frame(i + 1));

describe('stableBandHeight', () => {
  it('finds where the moving page starts', () => {
    expect(stableBandHeight(frames)).toBe(80);
  });
  it('says nothing about a recording that never moves', () => {
    expect(
      stableBandHeight([frame(1), frame(1)].map((f) => ({ ...f, data: frames[0].data }))),
    ).toBeNull();
  });
});

describe('strongestHorizontalLine', () => {
  it('picks the border under the toolbar, not the tab strip edge', () => {
    expect(strongestHorizontalLine(frames[0], 79)).toBe(80);
  });
});

describe('detectRecordedToolbar', () => {
  it('crops by itself when the band and the line agree', () => {
    const result = detectRecordedToolbar(frames, { displaySurface: 'window' });
    expect(result).toMatchObject({ action: 'crop', cropTop: 80, windowBarDefault: true });
  });
  it('also checks the known browser’s toolbar height', () => {
    expect(
      detectRecordedToolbar(frames, { displaySurface: 'window', browser: 'chrome' }).action,
    ).toBe('crop');
    // Safari's toolbar is never 80px at 2x: ask instead.
    expect(
      detectRecordedToolbar(frames, { displaySurface: 'window', browser: 'safari', scale: 2 })
        .action,
    ).toBe('adjust');
  });
  it("crops a known browser's toolbar even when the top of the page holds still too", () => {
    const still = Array.from({ length: 20 }, (_, i) => frame(i + 1, 80, true, 60));
    expect(stableBandHeight(still)).toBe(140);
    expect(
      detectRecordedToolbar(still, { displaySurface: 'window', browser: 'chrome' }),
    ).toMatchObject({
      action: 'crop',
      cropTop: 80,
    });
    // Without knowing the browser, a line short of the band's end is only a guess.
    expect(detectRecordedToolbar(still, { displaySurface: 'window' }).action).toBe('adjust');
  });
  it('asks when the signals disagree', () => {
    // No border line: the band alone is not enough.
    const plain = Array.from({ length: 20 }, (_, i) => frame(i + 1, 80, false));
    const result = detectRecordedToolbar(plain, { displaySurface: 'window' });
    expect(result.action).not.toBe('crop');
  });
  it('never crops a tab capture, and turns the bar off for a whole screen', () => {
    expect(detectRecordedToolbar(frames, { displaySurface: 'browser' })).toMatchObject({
      action: 'none',
      cropTop: 0,
      windowBarDefault: true,
    });
    expect(detectRecordedToolbar(frames, { displaySurface: 'monitor' })).toMatchObject({
      action: 'none',
      windowBarDefault: false,
    });
  });
  it('suggests but never applies a crop in manual mode, and does nothing when off', () => {
    expect(
      detectRecordedToolbar(frames, { displaySurface: 'window', mode: 'manual' }),
    ).toMatchObject({ action: 'adjust', cropTop: 80 });
    expect(detectRecordedToolbar(frames, { displaySurface: 'window', mode: 'off' }).action).toBe(
      'none',
    );
  });
});

describe('helpers', () => {
  it('turns the crop into a normalized cropRect', () => {
    expect(cropRectForToolbar(150, 600)).toEqual({ x: 0, y: 0.25, width: 1, height: 0.75 });
  });
  it('keeps one crop per video until the window size changes', () => {
    const crop = { mode: 'auto' as const, cropTop: 80, width: 400, height: 600 };
    expect(needsToolbarRedetect(crop, 400, 600)).toBe(false);
    expect(needsToolbarRedetect(crop, 800, 600)).toBe(true);
    expect(needsToolbarRedetect(null, 400, 600)).toBe(true);
  });
  it('samples about 20 frames across the recording', () => {
    const times = toolbarSampleTimes(10);
    expect(times).toHaveLength(20);
    expect(times[0]).toBeCloseTo(0.25);
  });
});
