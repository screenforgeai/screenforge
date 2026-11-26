/**
 * Wires captureTimeline's chunked-capture hooks to the main process's chunk
 * cache. Runs in the hidden export window, where the render state, the
 * analysed effect data and the timeline are exactly what the renderer uses.
 */
import type {
  CaptureWindowParams,
  ExportChunkStats,
  SerializedChunk,
  SerializedDecoderConfig,
} from '../../types';
import type { CapturePlanInfo, CaptureTimelineOptions } from './captureTimeline';
import type { MediaSegment } from '../../types/timeline';
import { normalizeMotionClips, resolveMotionAt } from '../animation/motionClips';
import { computeChunkKeys, hash128, stableStringify } from './chunkKeys';
import {
  CHUNK_WARMUP_SECONDS,
  groupMissingRuns,
  planChunks,
  type ExportChunk,
  type ExportRun,
} from './chunkPlan';

/** Bump when rendering changes in a way the app version would not capture. */
// v3: frames are read back as NV12 (nv12Readback.ts).
export const CHUNK_KEY_VERSION = 'chunk-v3';

/** How far after a chunk timed data can already affect it. */
export const CHUNK_LOOKAHEAD_SECONDS = 3;

export function chunkLookbackSeconds(params: Pick<CaptureWindowParams, 'storeSnapshot'>): number {
  const idleHide = params.storeSnapshot.cursorHideWhenIdle
    ? Number(params.storeSnapshot.cursorIdleHideSeconds) || 0
    : 0;
  return Math.max(5, CHUNK_WARMUP_SECONDS + 2, idleHide + 2);
}

/** Everything that can affect a chunk's pixels, for its content key. */
export function buildChunkKeyInputs(
  params: CaptureWindowParams,
  info: CapturePlanInfo,
  chunks: ExportChunk[],
): Parameters<typeof computeChunkKeys>[0] {
  // Motion poses carry over from earlier clips and depend on how clips sit on
  // segments, so instead of windowing motion clips, each chunk keys on the
  // motion the renderer resolves for its frames (same function, same inputs).
  // Camera layouts can blend with a neighbouring clip at any distance, so
  // camera clips count as global.
  const { motionClips, cameraClips, ...snapshot } = params.storeSnapshot;
  const motion = normalizeMotionClips(motionClips);
  const storeSegments = params.mediaSegments as MediaSegment[];
  return {
    version: CHUNK_KEY_VERSION,
    target: {
      // GIF renders through an MP4 at its own frame rate.
      container: params.format === 'gif' ? 'mp4' : params.format,
      width: params.targetWidth,
      height: params.targetHeight,
      fps: info.fps,
      quality: params.quality,
      resolution: params.resolution,
      // Chunks smoothed differently differ along every edge.
      edgeSmoothing: params.edgeSmoothing ?? 'msaa',
    },
    state: {
      storeSnapshot: snapshot,
      cameraClips: hash128(stableStringify(cameraClips ?? [])),
      frame: params.frame,
      recording: params.recording,
      mediaSegments: info.playableSegments,
      analyzedData: info.analyzedData,
      customWallpaper: params.customWallpaperDataUrl
        ? hash128(params.customWallpaperDataUrl)
        : null,
    },
    segments: info.playableSegments,
    chunks,
    fps: info.fps,
    lookbackSeconds: chunkLookbackSeconds(params),
    lookaheadSeconds: CHUNK_LOOKAHEAD_SECONDS,
    perChunk:
      motion.length === 0
        ? undefined
        : (chunk) => {
            const poses: unknown[] = [];
            for (let frame = chunk.startFrame; frame < chunk.endFrame; frame += 1) {
              poses.push(resolveMotionAt(motion, storeSegments, frame / info.fps));
            }
            return hash128(stableStringify(poses));
          },
  };
}

export interface ChunkedCaptureBridge {
  lookupExportChunks: (
    workspaceId: string,
    chunks: Array<{ key: string; startFrame: number; endFrame: number }>,
  ) => Promise<boolean[]>;
  startChunkRun: (
    workspaceId: string,
    runIndex: number,
    run: {
      startFrame: number;
      endFrame: number;
      chunks: Array<{ key: string; startFrame: number; endFrame: number }>;
    },
    decoderConfig: SerializedDecoderConfig | null,
  ) => Promise<void>;
  writeChunkRun: (
    workspaceId: string,
    runIndex: number,
    chunks: SerializedChunk[],
  ) => Promise<void>;
  endChunkRun: (workspaceId: string, runIndex: number) => Promise<void>;
}

export interface ChunkedCaptureHooks extends Required<
  Pick<CaptureTimelineOptions, 'planRuns' | 'onRunStart' | 'onRunChunks' | 'onRunEnd'>
> {
  keys: () => string[];
  stats: () => ExportChunkStats;
}

export function createChunkedCaptureHooks(
  params: CaptureWindowParams,
  bridge: ChunkedCaptureBridge,
  onProgress?: (progress: { total: number; cached: number }) => void,
): ChunkedCaptureHooks {
  let keys: string[] = [];
  let total = 0;
  let cachedCount = 0;
  let rendered = 0;

  const specFor = (chunk: ExportChunk) => ({
    key: keys[chunk.index],
    startFrame: chunk.startFrame,
    endFrame: chunk.endFrame,
  });

  return {
    async planRuns(info): Promise<ExportRun[]> {
      const chunks = planChunks(info.totalFrames, info.fps);
      keys = computeChunkKeys(buildChunkKeyInputs(params, info, chunks));
      total = chunks.length;
      const cached = await bridge.lookupExportChunks(params.workspaceId, chunks.map(specFor));
      cachedCount = cached.filter(Boolean).length;
      onProgress?.({ total, cached: cachedCount });
      return groupMissingRuns(chunks, cached);
    },
    async onRunStart(runIndex, run, decoderConfig) {
      await bridge.startChunkRun(
        params.workspaceId,
        runIndex,
        { startFrame: run.startFrame, endFrame: run.endFrame, chunks: run.chunks.map(specFor) },
        decoderConfig,
      );
    },
    async onRunChunks(runIndex, chunks) {
      await bridge.writeChunkRun(params.workspaceId, runIndex, chunks);
    },
    async onRunEnd(runIndex, run) {
      await bridge.endChunkRun(params.workspaceId, runIndex);
      rendered += run.chunks.length;
      cachedCount += run.chunks.length;
      onProgress?.({ total, cached: cachedCount });
    },
    keys: () => keys,
    stats: () => ({ total, rendered }),
  };
}
