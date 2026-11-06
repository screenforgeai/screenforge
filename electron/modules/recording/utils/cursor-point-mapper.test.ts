import { describe, expect, it } from 'vitest';
import { createNativeCursorPointMapper } from './cursor-point-mapper';

type Rect = { x: number; y: number; width: number; height: number };
type FakeDisplay = { bounds: Rect; physical: Rect; scaleFactor: number };

/**
 * Windows lays displays out in physical pixels; Electron reports DIP bounds.
 * This mirrors what Electron's screen.screenToDipPoint does on Windows: find
 * the display containing the physical point, then scale relative to its origin.
 */
function fakeScreenToDipPoint(displays: FakeDisplay[]) {
  return (point: { x: number; y: number }) => {
    const display =
      displays.find(
        ({ physical: p }) =>
          point.x >= p.x && point.x < p.x + p.width && point.y >= p.y && point.y < p.y + p.height,
      ) ?? displays[0];
    return {
      x: display.bounds.x + (point.x - display.physical.x) / display.scaleFactor,
      y: display.bounds.y + (point.y - display.physical.y) / display.scaleFactor,
    };
  };
}

// Laptop panel at 200% as primary, a 100% external monitor to its right.
const primary200: FakeDisplay = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  physical: { x: 0, y: 0, width: 3840, height: 2160 },
  scaleFactor: 2,
};
const external100: FakeDisplay = {
  bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
  physical: { x: 3840, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
};

describe('createNativeCursorPointMapper', () => {
  it('maps Windows physical hook coordinates on a 100% display next to a 200% one', () => {
    const map = createNativeCursorPointMapper(external100, {
      platform: 'win32',
      screenToDipPoint: fakeScreenToDipPoint([primary200, external100]),
    });

    // The middle of the external monitor, in the helper's physical pixels.
    expect(map(4800, 540)).toEqual({ x: 2880, y: 540 });
  });

  it('maps Windows physical coordinates on a 200% display to the right of a 100% one', () => {
    const left100: FakeDisplay = {
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      physical: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
    };
    const right200: FakeDisplay = {
      bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
      physical: { x: 1920, y: 0, width: 3840, height: 2160 },
      scaleFactor: 2,
    };
    const map = createNativeCursorPointMapper(right200, {
      platform: 'win32',
      screenToDipPoint: fakeScreenToDipPoint([left100, right200]),
    });

    // Dividing the whole global coordinate by the scale (the old heuristic)
    // gives x=1500 here, which is on the other monitor.
    expect(map(3000, 1000)).toEqual({ x: 2460, y: 500 });
  });

  it('keeps the single-display Windows result unchanged', () => {
    const map = createNativeCursorPointMapper(primary200, {
      platform: 'win32',
      screenToDipPoint: fakeScreenToDipPoint([primary200]),
    });

    expect(map(3000, 1600)).toEqual({ x: 1500, y: 800 });
  });

  it('leaves macOS points alone (the helper already reports logical points)', () => {
    const retina = { bounds: { x: 0, y: 0, width: 1512, height: 982 }, scaleFactor: 2 };
    const map = createNativeCursorPointMapper(retina, { platform: 'darwin' });

    for (let i = 0; i < 10; i++) {
      expect(map(1400 - i, 900 - i)).toEqual({ x: 1400 - i, y: 900 - i });
    }
  });

  it('falls back to the scale heuristic when no DIP conversion is available', () => {
    const map = createNativeCursorPointMapper(primary200, { platform: 'win32' });

    // Physical points beyond the DIP bounds resolve the heuristic to "scaled".
    for (let i = 0; i < 8; i++) {
      map(3000 + i, 2000);
    }
    expect(map(3000, 2000)).toEqual({ x: 1500, y: 1000 });
  });
});
