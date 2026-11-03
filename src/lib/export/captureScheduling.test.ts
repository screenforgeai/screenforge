import { describe, expect, it, vi } from 'vitest';
import type { MediaSegment } from '../../types/timeline';
import {
  clampMediaSegmentsToSourceDuration,
  createCaptureStallWatch,
  getSegmentIndexAtTime,
  getSyntheticEndMediaTime,
  isCaptureKeyFrame,
  resolveOutputFrameMode,
  shouldSeekAtSegmentBoundary,
} from './captureScheduling';

const SEGMENTS: MediaSegment[] = [
  {
    id: 'intro',
    timelineStart: 0,
    timelineEnd: 1,
    sourceStart: 0,
    sourceEnd: 1,
    videoEnabled: true,
    audioEnabled: true,
  },
  {
    id: 'muted-video',
    timelineStart: 1,
    timelineEnd: 1.5,
    sourceStart: 1,
    sourceEnd: 1.5,
    videoEnabled: false,
    audioEnabled: true,
  },
  {
    id: 'resume',
    timelineStart: 1.75,
    timelineEnd: 2.5,
    sourceStart: 2,
    sourceEnd: 2.75,
    videoEnabled: true,
    audioEnabled: true,
  },
];

describe('capture scheduling helpers', () => {
  it('marks a one-second cadence of keyframes', () => {
    expect(isCaptureKeyFrame(0, 30)).toBe(true);
    expect(isCaptureKeyFrame(1, 30)).toBe(false);
    expect(isCaptureKeyFrame(30, 30)).toBe(true);
    expect(isCaptureKeyFrame(60, 60)).toBe(true);
  });

  it('resolves black frames for gaps and video-disabled segments', () => {
    expect(resolveOutputFrameMode(SEGMENTS[0])).toBe('video');
    expect(resolveOutputFrameMode(SEGMENTS[1])).toBe('black');
    expect(resolveOutputFrameMode(null)).toBe('black');
  });

  it('tracks segment indices across normal segments and gaps', () => {
    expect(getSegmentIndexAtTime(SEGMENTS, 0.5)).toBe(0);
    expect(getSegmentIndexAtTime(SEGMENTS, 1.25)).toBe(1);
    expect(getSegmentIndexAtTime(SEGMENTS, 1.6)).toBe(-1);
    expect(getSegmentIndexAtTime(SEGMENTS, 2)).toBe(2);
  });

  it('seeks only when playback enters a new concrete segment', () => {
    expect(shouldSeekAtSegmentBoundary(-1, 0)).toBe(false);
    expect(shouldSeekAtSegmentBoundary(0, 0)).toBe(false);
    expect(shouldSeekAtSegmentBoundary(0, -1)).toBe(false);
    expect(shouldSeekAtSegmentBoundary(0, 1)).toBe(true);
  });

  it('extends the synthetic end media time by one frame', () => {
    expect(getSyntheticEndMediaTime(2, 30)).toBeCloseTo(2 + 1 / 30);
  });

  it('clamps media segments to the playable source duration', () => {
    expect(
      clampMediaSegmentsToSourceDuration(
        [
          {
            id: 'segment-a',
            timelineStart: 0,
            timelineEnd: 4,
            sourceStart: 0,
            sourceEnd: 4,
            videoEnabled: true,
            audioEnabled: true,
          },
          {
            id: 'segment-b',
            timelineStart: 4.5,
            timelineEnd: 6,
            sourceStart: 4.5,
            sourceEnd: 6,
            videoEnabled: true,
            audioEnabled: true,
          },
        ],
        3.2,
      ),
    ).toEqual([
      {
        id: 'segment-a',
        timelineStart: 0,
        timelineEnd: 3.2,
        sourceStart: 0,
        sourceEnd: 3.2,
        videoEnabled: true,
        audioEnabled: true,
      },
    ]);
  });

  it('fires the stall watchdog only when no progress arrives in time', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const watch = createCaptureStallWatch(250, onTimeout);

    watch.arm();
    vi.advanceTimersByTime(200);
    expect(onTimeout).not.toHaveBeenCalled();

    watch.arm();
    vi.advanceTimersByTime(249);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    watch.clear();
    vi.useRealTimers();
  });
});
