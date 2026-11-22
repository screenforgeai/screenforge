import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from 'src/store';
import type { MediaSegment } from 'src/types/timeline';
import { cutTimelineRanges } from './cutTimelineRanges';

const segment: MediaSegment = {
  id: 'v',
  timelineStart: 0,
  timelineEnd: 10,
  sourceStart: 0,
  sourceEnd: 10,
  videoEnabled: true,
  audioEnabled: true,
};

const totalLength = () =>
  useStore.getState().mediaSegments.reduce((sum, s) => sum + (s.timelineEnd - s.timelineStart), 0);

beforeEach(() => {
  act(() => {
    useStore.getState().resetEditorSession();
    useStore.setState({ mediaSegments: [segment], currentTime: 6, pendingSeekTime: null });
  });
});

describe('cutTimelineRanges', () => {
  it('cuts every range as one undo step and moves the playhead with the cut', () => {
    act(() => {
      cutTimelineRanges('Cut words', [
        { start: 1, end: 2 },
        { start: 3, end: 4 },
      ]);
    });
    expect(totalLength()).toBeCloseTo(8);
    expect(useStore.getState().pendingSeekTime).toBeCloseTo(4);

    act(() => {
      useStore.getState().undo();
    });
    expect(useStore.getState().mediaSegments).toEqual([segment]);
  });

  it('does nothing, and adds no undo step, when no media would be cut', () => {
    const pastBefore = useStore.getState().past.length;
    let result: unknown;
    act(() => {
      result = cutTimelineRanges('Cut words', [{ start: 20, end: 21 }]);
    });
    expect(result).toBeNull();
    expect(useStore.getState().past.length).toBe(pastBefore);
    expect(useStore.getState().pendingSeekTime).toBeNull();
  });
});
