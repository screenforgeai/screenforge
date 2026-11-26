import { describe, expect, it } from 'vitest';
import type { MediaSegment } from 'src/types/timeline';
import { findSegmentIdAtPlayhead, sortMediaSegments } from './segments';

const seg = (id: string, timelineStart: number, timelineEnd: number): MediaSegment => ({
  id,
  timelineStart,
  timelineEnd,
  sourceStart: timelineStart,
  sourceEnd: timelineEnd,
});

describe('findSegmentIdAtPlayhead', () => {
  it('finds the segment under the playhead, end excluded', () => {
    const segments = [seg('a', 0, 10), seg('b', 10, 20)];
    expect(findSegmentIdAtPlayhead(segments, 5)).toBe('a');
    expect(findSegmentIdAtPlayhead(segments, 10)).toBe('b');
    expect(findSegmentIdAtPlayhead(segments, 20)).toBeNull();
  });

  it('picks the earliest-starting segment where unsorted segments overlap', () => {
    // Moving A from [0,10] to [12,22] leaves [A, B] with B = [10,20]: at 15 both match.
    const segments = [seg('a', 12, 22), seg('b', 10, 20)];
    expect(findSegmentIdAtPlayhead(segments, 15)).toBe('b');
  });

  it('agrees with a lookup over the sorted segments, ties included', () => {
    const segments = [seg('c', 5, 30), seg('a', 12, 22), seg('b', 5, 20), seg('d', 25, 40)];
    for (const time of [0, 5, 12, 15, 21, 26, 35, 40]) {
      const sorted = sortMediaSegments(segments).find(
        (s) => time >= s.timelineStart && time < s.timelineEnd,
      );
      expect(findSegmentIdAtPlayhead(segments, time)).toBe(sorted?.id ?? null);
    }
  });

  it('finds nothing on an empty timeline', () => {
    expect(findSegmentIdAtPlayhead([], 3)).toBeNull();
  });
});
