import { describe, expect, it } from 'vitest';
import { isCaptureKeyFrame } from './captureScheduling';
import {
  CHUNK_SECONDS,
  chunkFrameCount,
  groupMissingRuns,
  planChunks,
  warmupFrameCount,
} from './chunkPlan';

describe('planChunks', () => {
  it('cuts the timeline into fixed chunks with a short last chunk', () => {
    const chunks = planChunks(250, 60);
    expect(chunks).toEqual([
      { index: 0, startFrame: 0, endFrame: 120 },
      { index: 1, startFrame: 120, endFrame: 240 },
      { index: 2, startFrame: 240, endFrame: 250 },
    ]);
  });

  it.each([15, 24, 25, 29.97, 30, 50, 60])('starts every chunk on a keyframe at %s fps', (fps) => {
    for (const chunk of planChunks(2000, fps)) {
      expect(isCaptureKeyFrame(chunk.startFrame, fps)).toBe(true);
    }
  });

  it('covers every frame exactly once', () => {
    const chunks = planChunks(1801, 30);
    let next = 0;
    for (const chunk of chunks) {
      expect(chunk.startFrame).toBe(next);
      next = chunk.endFrame;
    }
    expect(next).toBe(1801);
  });

  it('sizes chunks and warm-up from the frame rate', () => {
    expect(chunkFrameCount(60)).toBe(60 * CHUNK_SECONDS);
    expect(chunkFrameCount(29.97)).toBe(30 * CHUNK_SECONDS);
    expect(warmupFrameCount(60)).toBe(180);
  });
});

describe('groupMissingRuns', () => {
  const chunks = planChunks(600, 60); // 5 chunks

  it('renders everything as one run when nothing is cached', () => {
    const runs = groupMissingRuns(chunks, [false, false, false, false, false]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ startFrame: 0, endFrame: 600 });
    expect(runs[0].chunks).toHaveLength(5);
  });

  it('renders nothing when everything is cached', () => {
    expect(groupMissingRuns(chunks, [true, true, true, true, true])).toEqual([]);
  });

  it('groups adjacent missing chunks and skips cached ones', () => {
    const runs = groupMissingRuns(chunks, [true, false, false, true, false]);
    expect(runs.map((r) => [r.startFrame, r.endFrame])).toEqual([
      [120, 360],
      [480, 600],
    ]);
  });
});
