import { describe, expect, it } from 'vitest';
import type { MediaSegment } from 'src/types/timeline';
import { computeFadeOutAlpha } from './pixi';

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
