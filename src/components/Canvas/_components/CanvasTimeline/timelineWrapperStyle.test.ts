import { describe, expect, it } from 'vitest';
import { getTimelineWrapperStyle } from './timelineWrapperStyle';

const sizes = { height: 320, maxHeight: 480, minHeight: 120 };

describe('timeline panel size', () => {
  it('uses the dragged height, capped by the space left for the preview', () => {
    const style = getTimelineWrapperStyle({ focusMode: false, ...sizes });
    expect(style.height).toBe(320);
    expect(style.maxHeight).toBe(480);
  });

  it('collapses to the minimum in focus mode', () => {
    const style = getTimelineWrapperStyle({ focusMode: true, ...sizes });
    expect(style.height).toBe(120);
    expect(style.maxHeight).toBe(120);
  });

  it('changes size instantly: an animated height re-lays out the editor every frame', () => {
    for (const focusMode of [false, true]) {
      const style = getTimelineWrapperStyle({ focusMode, ...sizes });
      expect(style.transition).toBeUndefined();
    }
  });
});
