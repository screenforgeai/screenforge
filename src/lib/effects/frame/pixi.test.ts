import { describe, expect, it } from 'vitest';
import type { MediaSegment } from 'src/types/timeline';
import { computeFadeOutAlpha, uploadsWholeVideo } from './pixi';

const segment = (id: string, timelineStart: number, timelineEnd: number): MediaSegment => ({
  id,
  timelineStart,
  timelineEnd,
  sourceStart: timelineStart,
  sourceEnd: timelineEnd,
});

describe('computeFadeOutAlpha', () => {
  it('reports no active clip when the timeline is empty', () => {
    // Deleting the only clip leaves no segments; the caller indexes
    // segments[segIdx] whenever segIdx >= 0, so 0 here crashed every frame.
    expect(computeFadeOutAlpha(0, [])).toEqual({ alpha: 1, segIdx: -1 });
  });

  it('keeps a single clip fully visible', () => {
    expect(computeFadeOutAlpha(1, [segment('a', 0, 5)])).toEqual({ alpha: 1, segIdx: 0 });
  });

  it('finds the clip under the playhead', () => {
    const segments = [segment('a', 0, 5), segment('b', 5, 10)];

    expect(computeFadeOutAlpha(6, segments).segIdx).toBe(1);
  });
});

describe('uploadsWholeVideo', () => {
  const full = { x: 0, y: 0, width: 1920, height: 1080 };
  const video = document.createElement('video');

  it('uploads a preview video whole when nothing is cropped', () => {
    expect(uploadsWholeVideo(video, full, 1920, 1080)).toBe(true);
  });

  it('copies only the crop of a cropped preview video', () => {
    // The mip chain is built from whatever is uploaded, so a whole-video
    // upload would blend pixels from outside the crop into its edges.
    expect(uploadsWholeVideo(video, { ...full, x: 10, width: 1900 }, 1920, 1080)).toBe(false);
    expect(uploadsWholeVideo(video, { ...full, height: 1000 }, 1920, 1080)).toBe(false);
  });

  it('always copies the crop of a canvas source', () => {
    expect(uploadsWholeVideo(document.createElement('canvas'), full, 1920, 1080)).toBe(false);
  });
});
