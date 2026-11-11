import { describe, expect, it } from 'vitest';
import {
  cropRectFromPixels,
  DEFAULT_FRAME,
  getFrameGeometry,
  normalizeFrameSettings,
} from './analyze';

describe('cropRectFromPixels', () => {
  const sources = [
    { width: 1920, height: 1080 },
    { width: 2880, height: 1800 },
    { width: 3024, height: 1964 },
    { width: 2559, height: 1439 },
    { width: 4096, height: 2304 },
  ];
  const rects = [
    { x: 0, y: 0, width: 64, height: 64 },
    { x: 1, y: 1, width: 641, height: 359 },
    { x: 152, y: 75, width: 900, height: 601 },
    { x: 333, y: 777, width: 1001, height: 77 },
  ];

  it('makes the editor crop exactly the given pixels', () => {
    for (const source of sources) {
      for (const rect of rects) {
        const frame = {
          ...DEFAULT_FRAME,
          cropRect: cropRectFromPixels(rect, source.width, source.height),
        };
        const geometry = getFrameGeometry(frame, source.width, source.height);
        expect(geometry.cropRectPixels).toEqual(rect);
        // "Original" aspect sizes the canvas to the crop: no letterbox, no resize.
        expect([geometry.canvasWidth, geometry.canvasHeight]).toEqual([rect.width, rect.height]);
      }
    }
  });

  it('stays exact after a saved project is loaded again', () => {
    for (const source of sources) {
      for (const rect of rects) {
        const saved = JSON.parse(
          JSON.stringify({
            ...DEFAULT_FRAME,
            cropRect: cropRectFromPixels(rect, source.width, source.height),
          }),
        );
        const reloaded = normalizeFrameSettings(saved, undefined, source.width, source.height);
        expect(getFrameGeometry(reloaded, source.width, source.height).cropRectPixels).toEqual(
          rect,
        );
      }
    }
  });

  it('covers the whole source for a full-size rect', () => {
    expect(cropRectFromPixels({ x: 0, y: 0, width: 1920, height: 1080 }, 1920, 1080)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
  });
});
