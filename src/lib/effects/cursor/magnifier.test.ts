import { Matrix } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { computeMagnifierTransforms } from './magnifier';
import { MAGNIFIER_ZOOM } from './effects';

/**
 * A 1000×500 source cropped to x 250–750, y 100–350, shown in a 600×300
 * media rect at (100, 50) on the canvas, as the frame effect lays it out:
 * the video sprite is scaled and shifted so only the crop fills the media rect,
 * and the media mask is that rect, in the same parent space.
 */
const SCALE = 600 / 500; // media width / crop width
const MEDIA = { x: 100, y: 50, width: 600, height: 300 };
const CROP = { x: 250, y: 100, width: 500, height: 250 };

const recordingGlobal = new Matrix()
  .scale(SCALE, SCALE)
  .translate(MEDIA.x - CROP.x * SCALE, MEDIA.y - CROP.y * SCALE);
// The mask is drawn in canvas units in the same parent, so its transform is identity.
const maskGlobal = new Matrix();
const overlayGlobal = new Matrix();

/** Where a source pixel lands on screen inside the lens. */
const lensPoint = (lens: Matrix, sx: number, sy: number) => lens.apply({ x: sx, y: sy });

/** Whether a screen point is inside the lens's crop clip (the media rect, moved by `clip`). */
const insideClip = (clip: Matrix, p: { x: number; y: number }) => {
  const local = clip.applyInverse(p);
  return (
    local.x >= MEDIA.x &&
    local.x <= MEDIA.x + MEDIA.width &&
    local.y >= MEDIA.y &&
    local.y <= MEDIA.y + MEDIA.height
  );
};

describe('magnifier crop clipping', () => {
  // Cursor right by the crop's left and right edges, and a corner.
  it.each([
    ['left edge', MEDIA.x + 4, MEDIA.y + 150],
    ['right edge', MEDIA.x + MEDIA.width - 4, MEDIA.y + 150],
    ['top-left corner', MEDIA.x + 3, MEDIA.y + 3],
    ['bottom edge', MEDIA.x + 300, MEDIA.y + MEDIA.height - 2],
  ])('never shows source pixels outside the crop near the %s', (_where, cx, cy) => {
    const { lens, clip } = computeMagnifierTransforms(
      overlayGlobal,
      recordingGlobal,
      maskGlobal,
      cx,
      cy,
      MAGNIFIER_ZOOM,
    );

    // Pixels just outside the crop, on every side, are clipped away.
    for (const [sx, sy] of [
      [CROP.x - 1, CROP.y + 100],
      [CROP.x + CROP.width + 1, CROP.y + 100],
      [CROP.x + 10, CROP.y - 1],
      [CROP.x + 10, CROP.y + CROP.height + 1],
    ]) {
      expect(insideClip(clip, lensPoint(lens, sx, sy)), `source (${sx}, ${sy})`).toBe(false);
    }
    // Pixels inside the crop still show.
    for (const [sx, sy] of [
      [CROP.x + 1, CROP.y + 1],
      [CROP.x + CROP.width - 1, CROP.y + CROP.height - 1],
      [CROP.x + CROP.width / 2, CROP.y + CROP.height / 2],
    ]) {
      expect(insideClip(clip, lensPoint(lens, sx, sy)), `source (${sx}, ${sy})`).toBe(true);
    }
  });

  it('zooms the recording about the cursor', () => {
    const cx = 400;
    const cy = 200;
    const { lens } = computeMagnifierTransforms(
      overlayGlobal,
      recordingGlobal,
      maskGlobal,
      cx,
      cy,
      MAGNIFIER_ZOOM,
    );
    // The source pixel under the cursor stays under the cursor…
    const under = recordingGlobal.applyInverse({ x: cx, y: cy });
    const p = lensPoint(lens, under.x, under.y);
    expect(p.x).toBeCloseTo(cx);
    expect(p.y).toBeCloseTo(cy);
    // …and one screen pixel of recording becomes MAGNIFIER_ZOOM pixels.
    const right = recordingGlobal.applyInverse({ x: cx + 1, y: cy });
    expect(lensPoint(lens, right.x, right.y).x - cx).toBeCloseTo(MAGNIFIER_ZOOM);
  });

  it('places everything relative to the cursor layer, wherever that layer sits', () => {
    const shifted = new Matrix().translate(-40, 25);
    const base = computeMagnifierTransforms(
      overlayGlobal,
      recordingGlobal,
      maskGlobal,
      300,
      200,
      MAGNIFIER_ZOOM,
    );
    const moved = computeMagnifierTransforms(
      shifted,
      new Matrix().append(shifted).append(recordingGlobal),
      new Matrix().append(shifted).append(maskGlobal),
      300,
      200,
      MAGNIFIER_ZOOM,
    );
    expect(moved.lens.apply({ x: 300, y: 100 })).toEqual(base.lens.apply({ x: 300, y: 100 }));
    expect(moved.clip.apply({ x: 120, y: 60 })).toEqual(base.clip.apply({ x: 120, y: 60 }));
  });
});
