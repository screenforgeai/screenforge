/**
 * Chunked export: the timeline is cut into fixed-length chunks that can be
 * rendered independently, cached, and joined without re-encoding.
 *
 * Chunk boundaries sit on encoder keyframes (keyframes are forced every
 * round(fps) frames, see isCaptureKeyFrame), so every chunk starts with a
 * keyframe and joins cleanly with its neighbours.
 */

/** Chunk length. A multiple of the 1 s keyframe interval. */
export const CHUNK_SECONDS = 2;

/**
 * Effects with frame-to-frame state (cursor and zoom springs, click
 * animations, motion blur) are simulated for this long before a chunk that
 * does not start at frame 0, so the chunk begins in the same state a
 * single-pass export would reach. The slowest spring has a half-life of
 * ~0.12 s; 3 s shrinks any start-up difference by more than 2^-25.
 */
export const CHUNK_WARMUP_SECONDS = 3;

export interface ExportChunk {
  index: number;
  /** First output frame (inclusive). */
  startFrame: number;
  /** Last output frame (exclusive). */
  endFrame: number;
}

/** A contiguous stretch of chunks rendered in one encoder session. */
export interface ExportRun {
  startFrame: number;
  endFrame: number;
  chunks: ExportChunk[];
}

export function keyframeIntervalFrames(fps: number): number {
  return Math.max(1, Math.round(fps));
}

export function chunkFrameCount(fps: number): number {
  return keyframeIntervalFrames(fps) * CHUNK_SECONDS;
}

export function warmupFrameCount(fps: number): number {
  return Math.ceil(CHUNK_WARMUP_SECONDS * Math.max(1, fps));
}

export function planChunks(totalFrames: number, fps: number): ExportChunk[] {
  const size = chunkFrameCount(fps);
  const chunks: ExportChunk[] = [];
  for (let start = 0, index = 0; start < totalFrames; start += size, index += 1) {
    chunks.push({ index, startFrame: start, endFrame: Math.min(totalFrames, start + size) });
  }
  return chunks;
}

/** Groups the chunks that still need rendering into contiguous runs. */
export function groupMissingRuns(chunks: ExportChunk[], cached: readonly boolean[]): ExportRun[] {
  const runs: ExportRun[] = [];
  let current: ExportRun | null = null;
  for (const chunk of chunks) {
    if (cached[chunk.index]) {
      current = null;
      continue;
    }
    if (current && current.endFrame === chunk.startFrame) {
      current.endFrame = chunk.endFrame;
      current.chunks.push(chunk);
    } else {
      current = { startFrame: chunk.startFrame, endFrame: chunk.endFrame, chunks: [chunk] };
      runs.push(current);
    }
  }
  return runs;
}
