// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  applyFrameExtents,
  parseGtkFrameExtents,
  parseXwininfoGeometry,
} from './x11-window-geometry';

// Real `xwininfo -id 39845892` output captured on X11 (trimmed).
const REAL_OUTPUT = `
xwininfo: Window id: 0x2600004 "Some Window Title - Brave"

  Absolute upper-left X:  0
  Absolute upper-left Y:  32
  Relative upper-left X:  0
  Relative upper-left Y:  32
  Width: 1920
  Height: 1048
  Depth: 32
  Visual: 0x82
  Visual Class: TrueColor
  Border width: 0
  Class: InputOutput
  Map State: IsViewable
  Corners:  +0+32  -0+32  -0-0  +0-0
  -geometry 1920x1048+0-0
`;

describe('parseXwininfoGeometry', () => {
  it('parses absolute bounds from real xwininfo output', () => {
    expect(parseXwininfoGeometry(REAL_OUTPUT)).toEqual({
      x: 0,
      y: 32,
      width: 1920,
      height: 1048,
    });
  });

  it('parses negative coordinates (window on a display left of primary)', () => {
    const output = [
      '  Absolute upper-left X:  -2560',
      '  Absolute upper-left Y:  -14',
      '  Width: 1280',
      '  Height: 720',
    ].join('\n');

    expect(parseXwininfoGeometry(output)).toEqual({ x: -2560, y: -14, width: 1280, height: 720 });
  });

  it('does not confuse relative with absolute coordinates', () => {
    // "Relative upper-left X" also matches /upper-left X/ — the parser must
    // anchor on "Absolute".
    const parsed = parseXwininfoGeometry(REAL_OUTPUT.replace('X:  0', 'X:  640'));
    expect(parsed?.x).toBe(640);
  });

  it('returns null when geometry lines are missing (error output)', () => {
    expect(parseXwininfoGeometry('xwininfo: error: no window with id 0x123 exists!')).toBeNull();
    expect(parseXwininfoGeometry('')).toBeNull();
  });
});

describe('parseGtkFrameExtents', () => {
  it('parses real xprop output (GTK CSD shadow margins)', () => {
    expect(parseGtkFrameExtents('_GTK_FRAME_EXTENTS(CARDINAL) = 61, 61, 55, 67')).toEqual({
      left: 61,
      right: 61,
      top: 55,
      bottom: 67,
    });
  });

  it('returns null when the property is absent', () => {
    expect(parseGtkFrameExtents('_GTK_FRAME_EXTENTS:  not found.')).toBeNull();
    expect(parseGtkFrameExtents('')).toBeNull();
  });
});

describe('applyFrameExtents', () => {
  // Real case: GNOME Videos window — X window 1012×672 at (-11, 27), but
  // 61/61/55/67 of that is invisible shadow; visible window is 890×550.
  it('insets the X window bounds down to the visible window', () => {
    expect(
      applyFrameExtents(
        { x: -11, y: 27, width: 1012, height: 672 },
        { left: 61, right: 61, top: 55, bottom: 67 },
      ),
    ).toEqual({ x: 50, y: 82, width: 890, height: 550 });
  });

  it('passes bounds through when there are no extents', () => {
    const bounds = { x: 0, y: 32, width: 1920, height: 1048 };
    expect(applyFrameExtents(bounds, null)).toBe(bounds);
  });

  it('ignores extents that would collapse the window', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(applyFrameExtents(bounds, { left: 60, right: 60, top: 0, bottom: 0 })).toBe(bounds);
  });
});
