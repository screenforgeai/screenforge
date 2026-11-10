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
  const area = { x: 0, y: 0, width: 10, height: 10 };
  // Primary 1440x900 @2x (16:10), secondary 1920x1080 (16:9).
  const twoDisplays = {
    primary: display(1, 1440, 900, 2),
    all: [display(1, 1440, 900, 2), display(2, 1920, 1080)],
  };
  const oneDisplay = { primary: display(1, 1440, 900, 2), all: [display(1, 1440, 900, 2)] };
  const sized =
    (sizes: Record<string, { width: number; height: number }>) => (source: { id: string }) =>
      sizes[source.id] ?? { width: 0, height: 0 };

  it('returns the exact source for a display or window', () => {
    expect(
      pickSourceForCapture(sources, { kind: 'window', sourceId: 'window:42:0' }, twoDisplays)?.id,
    ).toBe('window:42:0');
    expect(
      pickSourceForCapture(sources, { kind: 'display', sourceId: 'screen:2:0' }, twoDisplays)?.id,
    ).toBe('screen:2:0');
  });

  it('uses the primary display for an area (the selector covers the primary display)', () => {
    expect(
      pickSourceForCapture(sources, { kind: 'area', sourceId: 'screen:2:0', area }, twoDisplays)
        ?.id,
    ).toBe('screen:1:0');
  });

  it('falls back to the only screen for a display capture (e.g. the Wayland portal)', () => {
    const portal = [{ id: 'screen:portal:0', display_id: '' }];
    expect(
      pickSourceForCapture(portal, { kind: 'display', sourceId: 'screen:wayland' }, twoDisplays)
        ?.id,
    ).toBe('screen:portal:0');
  });

  it('takes the only screen for an area when there is only one display', () => {
    const portal = [{ id: 'screen:portal:0', display_id: '' }];
    expect(pickSourceForCapture(portal, { kind: 'area', sourceId: '', area }, oneDisplay)?.id).toBe(
      'screen:portal:0',
    );
  });

  it('never crops another monitor with the primary display area', () => {
    // The portal handed back the secondary display: the area was drawn on the primary.
    const secondaryOnly = [{ id: 'screen:2:0', display_id: '2' }];
    expect(
      pickSourceForCapture(secondaryOnly, { kind: 'area', sourceId: '', area }, twoDisplays),
    ).toBeNull();
  });

  it('takes an unlabelled lone screen for an area only when no other display shares its shape', () => {
    const portal = [{ id: 'screen:portal:0', display_id: '' }];
    const request = { kind: 'area' as const, sourceId: '', area };
    // 16:10 image: only the primary is 16:10, so it's the primary.
    expect(
      pickSourceForCapture(
        portal,
        request,
        twoDisplays,
        sized({ 'screen:portal:0': { width: 2880, height: 1800 } }),
      )?.id,
    ).toBe('screen:portal:0');
    // 16:9 image: that's the secondary.
    expect(
      pickSourceForCapture(
        portal,
        request,
        twoDisplays,
        sized({ 'screen:portal:0': { width: 2880, height: 1620 } }),
      ),
    ).toBeNull();
    // Two 16:10 displays: no way to tell which one it is.
    const twins = {
      primary: display(1, 1440, 900, 2),
      all: [display(1, 1440, 900, 2), display(2, 1680, 1050)],
    };
    expect(
      pickSourceForCapture(
        portal,
        request,
        twins,
        sized({ 'screen:portal:0': { width: 2880, height: 1800 } }),
      ),
    ).toBeNull();
    // Without the image size, don't guess.
    expect(pickSourceForCapture(portal, request, twoDisplays)).toBeNull();
  });

  it('refuses to guess between several screens when none matches', () => {
    const others = { primary: display(99, 1440, 900), all: [display(99, 1440, 900)] };
    expect(
      pickSourceForCapture(sources, { kind: 'display', sourceId: 'screen:wayland' }, others),
    ).toBeNull();
    expect(pickSourceForCapture(sources, { kind: 'area', sourceId: '', area }, others)).toBeNull();
  });

  it('returns null for a window that is gone', () => {
    expect(
      pickSourceForCapture(sources, { kind: 'window', sourceId: 'window:7:0' }, twoDisplays),
    ).toBeNull();
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
