// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  areaToImageRect,
  fitWithin,
  getCaptureThumbnailSize,
  getDisplayPixelSize,
  pickSourceForCapture,
} from './capture-geometry';

const display = (id: number, width: number, height: number, scaleFactor = 1) => ({
  id,
  size: { width, height },
  scaleFactor,
});

describe('getDisplayPixelSize', () => {
  it('multiplies DIP size by the scale factor', () => {
    expect(getDisplayPixelSize(display(1, 1440, 900, 2))).toEqual({ width: 2880, height: 1800 });
  });
});

describe('getCaptureThumbnailSize', () => {
  it('covers the largest display in native pixels', () => {
    expect(getCaptureThumbnailSize([display(1, 1440, 900, 2), display(2, 1920, 1200, 1)])).toEqual({
      width: 2880,
      height: 1800,
    });
  });

  it('falls back to 1080p when no display is known', () => {
    expect(getCaptureThumbnailSize([])).toEqual({ width: 1920, height: 1080 });
  });
});

describe('pickSourceForCapture', () => {
  const sources = [
    { id: 'screen:1:0', display_id: '1' },
    { id: 'screen:2:0', display_id: '2' },
    { id: 'window:42:0', display_id: '' },
  ];

  it('returns the exact source for a display or window', () => {
    expect(pickSourceForCapture(sources, { kind: 'window', sourceId: 'window:42:0' }, 1)?.id).toBe(
      'window:42:0',
    );
    expect(pickSourceForCapture(sources, { kind: 'display', sourceId: 'screen:2:0' }, 1)?.id).toBe(
      'screen:2:0',
    );
  });

  it('uses the primary display for an area (the selector covers the primary display)', () => {
    expect(
      pickSourceForCapture(
        sources,
        { kind: 'area', sourceId: 'screen:2:0', area: { x: 0, y: 0, width: 10, height: 10 } },
        1,
      )?.id,
    ).toBe('screen:1:0');
  });

  it('falls back to the first screen when a display id is stale (e.g. Wayland)', () => {
    expect(
      pickSourceForCapture(sources, { kind: 'display', sourceId: 'screen:wayland' }, 99)?.id,
    ).toBe('screen:1:0');
  });

  it('returns null for a window that is gone', () => {
    expect(pickSourceForCapture(sources, { kind: 'window', sourceId: 'window:7:0' }, 1)).toBeNull();
  });
});

describe('areaToImageRect', () => {
  it('scales a DIP selection to image pixels', () => {
    expect(
      areaToImageRect(
        { x: 100, y: 50, width: 200, height: 100 },
        { width: 1440, height: 900 },
        { width: 2880, height: 1800 },
      ),
    ).toEqual({ x: 200, y: 100, width: 400, height: 200 });
  });

  it('clamps selections that spill past the display edge', () => {
    expect(
      areaToImageRect(
        { x: 1400, y: 880, width: 200, height: 100 },
        { width: 1440, height: 900 },
        { width: 1440, height: 900 },
      ),
    ).toEqual({ x: 1400, y: 880, width: 40, height: 20 });
  });

  it('returns null for an empty selection', () => {
    expect(
      areaToImageRect(
        { x: 2000, y: 2000, width: 50, height: 50 },
        { width: 1440, height: 900 },
        { width: 1440, height: 900 },
      ),
    ).toBeNull();
  });
});

describe('fitWithin', () => {
  it('scales down keeping the aspect ratio', () => {
    expect(fitWithin({ width: 4000, height: 2000 }, { width: 2000, height: 2000 })).toEqual({
      width: 2000,
      height: 1000,
    });
  });

  it('never scales up', () => {
    expect(fitWithin({ width: 800, height: 600 }, { width: 2000, height: 2000 })).toEqual({
      width: 800,
      height: 600,
    });
  });
});
