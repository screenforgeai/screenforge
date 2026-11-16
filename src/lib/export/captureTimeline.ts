import type { MediaSegment } from '../../types/timeline';
import type {
  RecordingResult,
  SerializedChunk,
  SerializedDecoderConfig,
  ExportFormat,
  ExportQuality,
  ExportResolution,
  ProjectCursorSettings,
  ExportCapturePerfStats,
} from '../../types/index';
import type { CursorData } from '../effects/cursor';
import { mapCursorDataToTimeline } from '../effects/cursor/analyze';
import { mapKeyboardDataToTimeline, type KeyboardData } from '../effects/keyboard';
import type { FrameSettings } from '../effects/frame';
import { findSegmentAtTime, sortMediaSegments } from '../helpers/segments';
import type { RenderSource } from '../effects/types';
import { createExportPixiApp } from '../pixi/createPixiApp';
import {
  analyzePixiEffects,
  getPixiUpdaterEffectId,
  setupPixiPipeline,
  tickPixiPipeline,
} from '../pixi/pipeline';
import { startsChunk, warmupFrameCount, type ExportRun } from './chunkPlan';
import { useStore } from '../../store';
import { renderTimelineAudio } from './audioTimeline';
import { VideoEncoderWrapper } from './videoEncoder';
import {
  clampMediaSegmentsToSourceDuration,
  isCaptureKeyFrame,
  resolveOutputFrameMode,
  VIDEO_DECODE_STALL_ERROR,
} from './captureScheduling';
import { createExportVideoFrameSource, type ExportVideoFrameSource } from './videoFrameSource';
import { preloadWallpapersAsync, preloadCustomWallpaperAsync } from '../effects/frame/wallpapers';
import { computeExportRenderSize } from './renderSizing';
import { createExportPace } from './exportPace';

const CAPTURE_STALL_TIMEOUT_MS = 15_000;
const CAPTURE_YIELD_INTERVAL_FRAMES = 12;
const CAPTURE_FRAME_BATCH_SIZE = 120;
const CAPTURE_WRITER_BACKPRESSURE_INTERVAL_FRAMES = 60;
const CAPTURE_MAX_PENDING_CHUNK_BATCHES = 3;
// Max frames the hardware encoder may buffer before we pause submission.
// 6 frames provides ~100ms of pipeline depth at 60fps — enough to keep
// VideoToolbox saturated. The IOSurface cross-queue issue is eliminated by
// the CPU pixel-buffer path (gl.readPixels W×H → VideoFrame from ArrayBuffer),
// so this value no longer affects how long gl.readPixels blocks.
const CAPTURE_MAX_PENDING_ENCODER_FRAMES = 6;
const CAPTURE_FRAME_PROGRESS_MAX = 0.96;
const CAPTURE_FLUSH_PROGRESS = 0.98;
const CAPTURE_DONE_PROGRESS = 0.99;
// Effects whose output depends on earlier frames (springs, click animations,
// motion blur). Only these are simulated before a chunk that starts mid-way.
const WARMUP_EFFECT_IDS = new Set(['cursor', 'zoom']);

// ── Types ──────────────────────────────────────────────────────────────────

export interface CaptureTimelineOptions {
  recording: RecordingResult;
  mediaSegments: MediaSegment[];
  frame: FrameSettings;
  duration: number;
  fps: number; // target export FPS
  sourceFps: number; // source video FPS from probe (used for rVFC mismatch handling)
  targetWidth: number; // output canvas width  (e.g. 1920 for 1080p)
  targetHeight: number; // output canvas height (e.g. 1080 for 1080p)
  format: ExportFormat;
  quality: ExportQuality;
  resolution: ExportResolution;
  includeAudio: boolean;
  cursor: Pick<ProjectCursorSettings, 'clickSound' | 'clickSoundVolume'>;
  musicClips?: import('../timeline').MusicClip[];
  signal?: AbortSignal;
  onProgress?: (value: number) => void;
  /**
   * Called with a batch of encoded video chunks.
   * Implementer should forward to main process via IPC.
   */
  onChunk: (chunks: SerializedChunk[]) => Promise<void>;
  /**
   * Called once when the VideoDecoderConfig is available (before first chunk batch).
   * Implementer should call initMuxer IPC here.
   */
  onInitMuxer: (decoderConfig: SerializedDecoderConfig | null) => Promise<void>;
  /**
   * Chunked export. Called once the timeline is known. Returns the
   * chunk-aligned frame runs to render — each in its own encoder session,
   * with timestamps relative to the run start — or null for a single pass.
   */
  planRuns?: (info: CapturePlanInfo) => Promise<ExportRun[] | null>;
  /** A run's encoder produced its decoder config; open the run's muxer. */
  onRunStart?: (
    runIndex: number,
    run: ExportRun,
    decoderConfig: SerializedDecoderConfig | null,
  ) => Promise<void>;
  onRunChunks?: (runIndex: number, chunks: SerializedChunk[]) => Promise<void>;
  /** A run's encoder has flushed every frame. */
  onRunEnd?: (runIndex: number, run: ExportRun) => Promise<void>;
  /** Skip rendering audio (background pre-rendering has no use for it). */
  skipAudio?: boolean;
  /**
   * Share of wall time spent rendering (0–1]. Below 1 the capture pauses
   * after each burst of frames, so a background pre-render leaves the GPU
   * and CPU to the editor. Exports leave it at 1.
   */
  dutyCycle?: number;
  /** Writes a line to the app log; used for render speed diagnostics. */
  onDiagnostic?: (event: string, data: Record<string, unknown>) => void;
}

export interface CapturePlanInfo {
  totalFrames: number;
  fps: number;
  playableSegments: MediaSegment[];
  /** Analysed effect data, remapped to the timeline as the renderer uses it. */
  analyzedData: Map<string, unknown>;
}

export interface CaptureTimelineResult {
  frameCount: number;
  audioWavBuffer?: ArrayBuffer;
  perfStats: ExportCapturePerfStats;
  /** Set for a chunked capture: the runs that were rendered. */
  runs?: ExportRun[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sortSegments(segments: MediaSegment[]): MediaSegment[] {
  return sortMediaSegments(segments);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function clampSourceTime(value: number, sourceDuration: number): number {
  const maxSourceTime = Math.max(0, sourceDuration - 1 / 240);
  return Math.max(0, Math.min(value, maxSourceTime));
}

interface CaptureFrameBatch {
  mode: 'video' | 'black';
  frameIndices: number[];
  outputTimes: number[];
  sourceTimes: number[];
}

function buildCaptureFrameBatch(
  segments: MediaSegment[],
  totalFrames: number,
  fps: number,
  startFrame: number,
  sourceDuration: number,
): CaptureFrameBatch {
  const seedOutputTime = startFrame / fps;
  const seedSegment = findSegmentAtTime(segments, seedOutputTime);
  const seedMode = resolveOutputFrameMode(seedSegment);
  const seedSegmentId = seedSegment?.id ?? null;

  const frameIndices: number[] = [];
  const outputTimes: number[] = [];
  const sourceTimes: number[] = [];

  for (
    let frameIndex = startFrame;
    frameIndex < totalFrames && frameIndices.length < CAPTURE_FRAME_BATCH_SIZE;
    frameIndex += 1
  ) {
    const outputTime = frameIndex / fps;
    const activeSegment = findSegmentAtTime(segments, outputTime);
    const activeMode = resolveOutputFrameMode(activeSegment);
    const activeSegmentId = activeSegment?.id ?? null;

    if (activeMode !== seedMode || activeSegmentId !== seedSegmentId) {
      break;
    }

    frameIndices.push(frameIndex);
    outputTimes.push(outputTime);

    if (seedMode === 'video' && activeSegment) {
      const segSpeed = activeSegment.speed ?? 1;
      sourceTimes.push(
        clampSourceTime(
          activeSegment.sourceStart + (outputTime - activeSegment.timelineStart) * segSpeed,
          sourceDuration,
        ),
      );
    }
  }

  return {
    mode: seedMode,
    frameIndices,
    outputTimes,
    sourceTimes,
  };
}

// ── Main export function ───────────────────────────────────────────────────

export async function captureTimeline(
  opts: CaptureTimelineOptions,
): Promise<CaptureTimelineResult> {
  const {
    recording,
    mediaSegments,
    frame,
    duration,
    fps,
    targetWidth,
    targetHeight,
    format,
    quality,
    resolution,
    includeAudio,
    signal,
    onProgress,
    onChunk,
    onInitMuxer,
    cursor,
    musicClips,
  } = opts;

  const orderedSegments = sortSegments(mediaSegments);
  if (orderedSegments.length === 0) {
    throw new Error('No media segments found in timeline');
  }
  const requestedDuration = Math.max(0, duration);
  if (requestedDuration === 0) {
    throw new Error('Recording has zero duration');
  }

  const fixedDt = 1 / fps;
  let videoFrameSource: ExportVideoFrameSource | null = null;
  let cameraFrameSource: ExportVideoFrameSource | null = null;

  // Destroyed in the finally block.
  let pixiScene: Awaited<ReturnType<typeof createExportPixiApp>> | null = null;

  const cleanup = () => {
    cameraFrameSource?.dispose();
    videoFrameSource?.dispose();
    pixiScene?.app.destroy(false);
    pixiScene = null;
  };

  const captureStartedAt = performance.now();
  let decodeWaitMs = 0;
  let renderMs = 0;
  let gpuSyncMs = 0;
  let encodeMs = 0;
  let encoderFlushMs = 0;
  let writerBackpressureMs = 0;
  let restMs = 0;
  let audioRenderMs = 0;
  let batchCount = 0;
  let yieldedFrameCount = 0;
  let videoFrameCount = 0;
  let blackFrameCount = 0;
  let cameraFrameCount = 0;

  try {
    const { camera } = useStore.getState();
    videoFrameSource = await createExportVideoFrameSource({
      filePath: recording.filePath,
    });
    const cameraEnabled = camera.enabled && Boolean(recording.cameraPath);
    if (cameraEnabled) {
      cameraFrameSource = await createExportVideoFrameSource({
        filePath: recording.cameraPath as string,
      });
    }

    const sourceDuration =
      Number.isFinite(videoFrameSource.duration) && videoFrameSource.duration > 0
        ? videoFrameSource.duration
        : requestedDuration;
    const playableSegments = clampMediaSegmentsToSourceDuration(orderedSegments, sourceDuration);
    if (playableSegments.length === 0) {
      throw new Error('Recording source has no playable media range for export');
    }

    const totalDuration = playableSegments.reduce(
      (max, segment) => Math.max(max, segment.timelineEnd),
      0,
    );
    if (totalDuration === 0) {
      throw new Error('Recording has zero playable duration');
    }

    // timelineEnd already reflects speed (timelineStart + sourceDuration/speed),
    // so totalDuration is the correct effective output duration.
    const totalFrames = Math.max(1, Math.round(totalDuration * fps));

    // ── PixiJS app at standard encoder resolution ───────────────────────
    const sourceWidth = videoFrameSource.width || 1280;
    const sourceHeight = videoFrameSource.height || 800;
    // renderSize describes the content area within the standard canvas.
    // For 16:9 sources this equals targetWidth×targetHeight exactly.
    // For non-16:9 (e.g. 16:10 MacBook), the content area is narrower/shorter;
    // the stage offset below centers it with transparent margins that encode
    // as black in H.264 (which has no alpha channel).
    const renderSize = computeExportRenderSize(
      frame,
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
    );

    // Always create the PixiJS canvas at exactly targetWidth×targetHeight so
    // VideoToolbox hardware H.264 gets a standard resolution (1920×1080, etc.).
    // Non-standard widths (e.g. 1728) fall back to software encoding (~18fps vs 60fps+).
    pixiScene = await createExportPixiApp(targetWidth, targetHeight);
    pixiScene.sourceWidth = renderSize.sourceWidth;
    pixiScene.sourceHeight = renderSize.sourceHeight;
    pixiScene.renderScale = renderSize.renderScale;

    // Center the content area within the standard canvas. For 16:9 sources the
    // offset is 0. For non-16:9 sources (e.g. 16:10) the content is narrower
    // than targetWidth; centering adds equal black margins on each side.
    const contentOffsetX = Math.floor((targetWidth - renderSize.canvasWidth) / 2);
    const contentOffsetY = Math.floor((targetHeight - renderSize.canvasHeight) / 2);
    if (contentOffsetX !== 0 || contentOffsetY !== 0) {
      pixiScene.app.stage.x = contentOffsetX;
      pixiScene.app.stage.y = contentOffsetY;
    }

    // Async PBO (Pixel Buffer Object) readback pipeline.
    //
    // Previously, gl.readPixels(W×H) after every render blocked the CPU for ~26ms
    // waiting for the WebGL Metal pipeline to drain. With async PBOs, we submit the
    // readback command non-blocking (gl.readPixels with PIXEL_PACK_BUFFER bound + offset=0),
    // then immediately render the next frame. After PBO_SUB_BATCH frames are queued,
    // a single gl.finish() drains all pending GPU commands at once. The GPU processes
    // PBO_SUB_BATCH frames in one Metal scheduling window (~26ms total).
    //
    // gl.finish() is used instead of fence polling (clientWaitSync + setTimeout) because
    // Electron's hidden-window timer throttling causes setTimeout to fire at 1+ second
    // intervals, making fence polling extremely slow despite 26ms GPU fences.
    //
    // gl.readPixels into a PBO fills GPU-side memory without CPU stall.
    // gl.getBufferSubData reads it to CPU after gl.finish() ensures completion.
    // Rows come out bottom-to-top (WebGL origin) so we Y-flip before VideoFrame.
    const exportCanvas = pixiScene.app.canvas as HTMLCanvasElement;
    const gl =
      exportCanvas.getContext('webgl2') ??
      (exportCanvas.getContext('webgl') as WebGL2RenderingContext | null);
    if (!gl) {
      throw new Error(
        '[Export] Failed to get WebGL context from export canvas — WebGL is required',
      );
    }

    // How many frames to batch before a single gl.finish() drain.
    // gl.finish() blocks until ALL submitted GPU commands complete — no setTimeout,
    // no timer throttling. The GPU batches PBO_SUB_BATCH frames' rendering in
    // roughly one Metal scheduling window (~26ms total vs PBO_SUB_BATCH × 26ms sequential).
    const PBO_SUB_BATCH = 8;
    const PBO_COUNT = PBO_SUB_BATCH;
    const frameByteSize = targetWidth * targetHeight * 4;

    const pboPool: WebGLBuffer[] = [];
    const pboCpuBuffers: Uint8Array[] = [];
    for (let i = 0; i < PBO_COUNT; i++) {
      const pbo = gl.createBuffer();
      if (!pbo) {
        throw new Error('[Export] Failed to allocate PBO');
      }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, frameByteSize, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      pboPool.push(pbo);
      pboCpuBuffers.push(new Uint8Array(frameByteSize));
    }

    // One fence per PBO slot — created after each readPixels, consumed in drainAndEncodePending.
    // After gl.finish() these are guaranteed ALREADY_SIGNALED; clientWaitSync is instant.
    const pboFences: (WebGLSync | null)[] = new Array(PBO_COUNT).fill(null);
    const yFlipTemp = new Uint8Array(targetWidth * 4);

    interface PendingPboFrame {
      pboIdx: number;
      outputTime: number;
      isKeyFrame: boolean;
    }
    const pendingPbos: PendingPboFrame[] = [];
    let pboPoolCursor = 0;

    // Black canvas for gap/silence frames — 2D canvas is zero-initialized (transparent/black).
    // VideoFrame copies pixel data at construction so the same canvas can be reused.
    const blackCanvas = document.createElement('canvas');
    blackCanvas.width = targetWidth;
    blackCanvas.height = targetHeight;

    // Ensure wallpaper images are fully loaded before the frame loop starts.
    // In the export worker window, Texture.from(url_string) returns undefined
    // (PixiJS cache miss), so we must have the HTMLImageElement ready first.
    await preloadWallpapersAsync();
    await preloadCustomWallpaperAsync();

    // ── Effect pipeline setup (PixiJS) ───────────────────────────────────
    // onLoad is deliberately SKIPPED — mutates Zustand store (React-only safe).
    const analyzedData = analyzePixiEffects(recording, {
      remapData: (effectId, analyzed) =>
        effectId === 'cursor'
          ? mapCursorDataToTimeline(analyzed as CursorData, playableSegments)
          : effectId === 'keyboard'
            ? mapKeyboardDataToTimeline(analyzed as KeyboardData, playableSegments)
            : analyzed,
    });
    const updaters = await setupPixiPipeline(analyzedData, pixiScene);

    const assertNotAborted = () => {
      if (signal?.aborted) {
        throw new Error('Export rendering cancelled');
      }
    };

    const runs = opts.planRuns
      ? await opts.planRuns({ totalFrames, fps, playableSegments, analyzedData })
      : null;
    assertNotAborted();

    const cursorAnalysis = analyzedData.get('cursor') as CursorData | undefined;
    const cursorClickEvents = cursorAnalysis?.clickEvents ?? [];
    const cursorPressEvents = cursorAnalysis?.pressEvents ?? [];
    const audioStartedAt = performance.now();
    const audioPromise = renderTimelineAudio({
      recording,
      orderedSegments: playableSegments,
      duration: totalDuration,
      includeAudio: includeAudio && !opts.skipAudio,
      cursor,
      clickEvents: cursorClickEvents,
      pressEvents: cursorPressEvents,
      musicClips,
      signal,
    });
    void audioPromise.then(
      () => {
        audioRenderMs = performance.now() - audioStartedAt;
      },
      () => undefined,
    );

    // Renders one frame into the WebGL framebuffer. Readback is initiated separately
    // via initiateReadback() so multiple frames can be queued to the GPU before any
    // CPU collection stall (the async PBO pipeline).
    const drawFrame = (
      sourceTime: number,
      outputTime: number,
      dt: number,
      renderSource: RenderSource,
      cameraRenderSource: RenderSource | null,
    ): void => {
      if (!pixiScene) {
        throw new Error('PixiJS scene was destroyed before frame render');
      }
      try {
        tickPixiPipeline(updaters, sourceTime, dt, {
          videoSource: renderSource,
          cameraSource: cameraRenderSource,
          outputTime,
        });
        pixiScene.app.renderer.render(pixiScene.app.stage);
      } catch (err) {
        console.error('[Export] Frame render failed at t=', sourceTime, String(err));
        throw err;
      }
    };

    // Enqueues a non-blocking GPU→PBO transfer for the current framebuffer contents.
    // Buffer orphaning (gl.bufferData before gl.readPixels) tells the driver the old
    // shadow copy can be discarded, eliminating the "READ-usage buffer written again
    // before being read back" Metal/WebGL performance warning.
    const initiateReadback = (outputTime: number, isKeyFrame: boolean): void => {
      const pboIdx = pboPoolCursor % PBO_COUNT;
      pboPoolCursor += 1;

      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboPool[pboIdx]);
      // Orphan: allocate fresh GPU memory so the driver doesn't stall on the old shadow copy.
      gl.bufferData(gl.PIXEL_PACK_BUFFER, frameByteSize, gl.STREAM_READ);
      // offset=0 (integer, not Uint8Array) → PBO-backed async GPU readback (non-blocking)
      gl.readPixels(0, 0, targetWidth, targetHeight, gl.RGBA, gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

      // Fence marks when this PBO's readback is safe to read on CPU. We don't poll it with
      // setTimeout (throttled in hidden Electron windows). Instead gl.finish() in
      // drainAndEncodePending() drains all GPU commands first, then clientWaitSync()
      // returns ALREADY_SIGNALED instantly — no async wait needed.
      const existingFence = pboFences[pboIdx];
      if (existingFence !== null) {
        gl.deleteSync(existingFence);
      }
      pboFences[pboIdx] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);

      pendingPbos.push({ pboIdx, outputTime, isKeyFrame });
    };

    // Drains all pending PBOs at once using gl.finish() — a hard GPU sync that blocks
    // until every submitted command (including all PBO readbacks) completes. Unlike
    // fence polling (clientWaitSync + setTimeout), gl.finish() is a synchronous call
    // that is NOT subject to Electron's hidden-window timer throttling, so it never
    // stalls for 1+ seconds. The GPU pipeline benefit is preserved: PBO_SUB_BATCH
    // frames' worth of rendering + readback commands execute in one Metal scheduling
    // window (~26ms total) rather than PBO_SUB_BATCH × 26ms sequentially.
    // Encoded timestamps are relative to the start of the current run (0 for
    // a single-pass export), so every run's file starts at time zero.
    let timestampOffsetSeconds = 0;
    const toTimestampMicros = (outputTime: number): number =>
      Math.round((outputTime - timestampOffsetSeconds) * 1_000_000);

    // A chunk must start on a keyframe, but some encoders (seen with Windows'
    // software H.264 encoder) skip a keyframe request while frames are queued
    // behind it. In a chunked capture the queue is emptied before each chunk's
    // first frame; a single-pass export never waits here.
    const drainBeforeChunkStart = async (outputTime: number): Promise<void> => {
      if (runs !== null && startsChunk(Math.round(outputTime * fps), fps)) {
        await encoder.waitForEncoderCapacity(0);
      }
    };

    const drainAndEncodePending = async (): Promise<void> => {
      if (pendingPbos.length === 0) {
        return;
      }

      const syncStart = performance.now();
      gl.finish(); // blocks until ALL pending GPU commands (renders + PBO readbacks) complete
      gpuSyncMs += performance.now() - syncStart;

      const frames = pendingPbos.splice(0, pendingPbos.length);
      for (const { pboIdx, outputTime, isKeyFrame } of frames) {
        // Satisfy the driver's fence requirement before getBufferSubData. After gl.finish()
        // the fence is guaranteed ALREADY_SIGNALED so clientWaitSync returns immediately —
        // no async polling, no setTimeout throttling. Without this, the driver logs
        // "READ-usage buffer was read back without waiting on a fence" and inserts its own
        // implicit stall.
        const fence = pboFences[pboIdx];
        if (fence !== null) {
          // WebGL sets MAX_CLIENT_WAIT_TIMEOUT_WEBGL = 0 to prevent blocking the renderer
          // thread, so timeout MUST be 0 — any non-zero value causes INVALID_OPERATION.
          // After gl.finish(), the fence is guaranteed ALREADY_SIGNALED so this returns
          // instantly. A cosmetic ANGLE warning ("read back without waiting on a fence")
          // may still appear: ANGLE's internal Metal PBO blit tracking is separate from
          // GL sync objects and gl.finish(), so it cannot be fully suppressed through user
          // GL code. The warning is a false positive — gl.finish() ensures the GPU is idle
          // and getBufferSubData completes immediately with no actual pipeline stall.
          const status = gl.clientWaitSync(fence, gl.SYNC_FLUSH_COMMANDS_BIT, 0);
          if (status === gl.WAIT_FAILED) {
            throw new Error('[Export] GPU fence wait failed — encoder may be in a bad state');
          }
          gl.deleteSync(fence);
          pboFences[pboIdx] = null;
        }

        const cpuBuf = pboCpuBuffers[pboIdx];
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pboPool[pboIdx]);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, cpuBuf);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);

        // Y-flip: gl.readPixels stores rows bottom-to-top; VideoFrame expects top-to-bottom.
        const rowBytes = targetWidth * 4;
        const halfH = Math.floor(targetHeight / 2);
        for (let y = 0; y < halfH; y++) {
          const topOff = y * rowBytes;
          const botOff = (targetHeight - 1 - y) * rowBytes;
          yFlipTemp.set(cpuBuf.subarray(topOff, topOff + rowBytes));
          cpuBuf
            .subarray(topOff, topOff + rowBytes)
            .set(cpuBuf.subarray(botOff, botOff + rowBytes));
          cpuBuf.subarray(botOff, botOff + rowBytes).set(yFlipTemp);
        }

        const encodeStart = performance.now();
        await drainBeforeChunkStart(outputTime);
        encoder.encodePixelBuffer(
          cpuBuf,
          targetWidth,
          targetHeight,
          toTimestampMicros(outputTime),
          isKeyFrame,
        );
        await encoder.waitForEncoderCapacity(CAPTURE_MAX_PENDING_ENCODER_FRAMES);
        encodeMs += performance.now() - encodeStart;
        if (encoderError) {
          throw encoderError;
        }
      }
    };

    // ── VideoEncoder setup ─────────────────────────────────────────────────
    // Store a reference to the Promise reject so onError can propagate failures
    // into the rVFC capture loop (onError fires outside the Promise scope).
    let encoderError: Error | null = null;
    let encoderLogged = false;

    const createEncoder = async (handlers: {
      onChunks: (chunks: SerializedChunk[]) => Promise<void>;
      onConfig: (config: SerializedDecoderConfig | null) => Promise<void>;
    }): Promise<VideoEncoderWrapper> => {
      const { wrapper, decoderConfig, config } = await VideoEncoderWrapper.create({
        format,
        quality,
        resolution,
        width: targetWidth,
        height: targetHeight,
        fps,
        onChunkBatch: async (chunks) => {
          assertNotAborted();
          await handlers.onChunks(chunks);
          assertNotAborted();
        },
        onDecoderConfig: async (config) => {
          assertNotAborted();
          await handlers.onConfig(config);
          assertNotAborted();
        },
        onError: (err) => {
          encoderError = err;
        },
      });

      if (!encoderLogged) {
        encoderLogged = true;
        opts.onDiagnostic?.('export:capture:encoder', {
          ...config,
          width: targetWidth,
          height: targetHeight,
          fps,
        });
      }
      // If decoderConfig came from isConfigSupported pre-flight, initMuxer now
      if (decoderConfig !== null) {
        assertNotAborted();
        await handlers.onConfig(decoderConfig);
        assertNotAborted();
        wrapper.markMuxerReady();
      }
      // If null: initMuxer will be called lazily via onDecoderConfig on first keyframe
      return wrapper;
    };

    // A chunked capture opens one encoder per run, inside the loop below.
    let encoder!: VideoEncoderWrapper;
    // A run's encoder is closed once flushed; closing it twice would throw.
    let encoderOpen = false;
    if (runs === null) {
      encoder = await createEncoder({ onChunks: onChunk, onConfig: onInitMuxer });
      encoderOpen = true;
    }

    // ── Frame capture loop ────────────────────────────────────────────────
    let currentOutputFrame = 0;
    let loopEndFrame = totalFrames;
    const dutyCycle = Math.min(1, Math.max(0.05, opts.dutyCycle ?? 1));
    let busySince = performance.now();
    // Yields to the event loop; under a duty cycle, also rests for long enough
    // that rendering takes only `dutyCycle` of the time since the last rest.
    const yieldAndRest = async (): Promise<void> => {
      yieldedFrameCount += 1;
      pace.sample(renderedInEarlierRuns + currentOutputFrame - currentRunStartFrame, {
        decodeWaitMs,
        renderMs,
        encodeMs,
        writerBackpressureMs,
        restMs,
      });
      const restFor =
        dutyCycle < 1 ? ((performance.now() - busySince) * (1 - dutyCycle)) / dutyCycle : 0;
      const restStartedAt = performance.now();
      await new Promise<void>((resolve) => setTimeout(resolve, restFor));
      busySince = performance.now();
      restMs += busySince - restStartedAt;
    };
    const framesToRender = runs
      ? runs.reduce((sum, run) => sum + (run.endFrame - run.startFrame), 0)
      : totalFrames;
    let renderedInEarlierRuns = 0;
    let currentRunStartFrame = 0;
    // Every 5 s: frames done and the rate since the last line.
    const pace = createExportPace({
      totalFrames: framesToRender,
      intervalMs: 5000,
      emit: (data) => opts.onDiagnostic?.('export:capture:pace', data),
    });
    opts.onDiagnostic?.('export:capture:setup', {
      setupMs: Math.round(performance.now() - captureStartedAt),
      totalFrames,
      framesToRender,
      runs: runs?.length ?? null,
      fps,
      dutyCycle,
    });
    const reportFrameProgress = (): void => {
      const done = renderedInEarlierRuns + currentOutputFrame - currentRunStartFrame;
      onProgress?.((done / Math.max(1, framesToRender)) * CAPTURE_FRAME_PROGRESS_MAX);
    };
    const waitForWriterIfNeeded = async (): Promise<void> => {
      if (
        currentOutputFrame === 0 ||
        currentOutputFrame % CAPTURE_WRITER_BACKPRESSURE_INTERVAL_FRAMES !== 0
      ) {
        return;
      }

      const waitStartedAt = performance.now();
      await encoder.waitForPendingWrites(CAPTURE_MAX_PENDING_CHUNK_BATCHES);
      writerBackpressureMs += performance.now() - waitStartedAt;
      assertNotAborted();
    };

    const renderUntil = async (endFrame: number): Promise<void> => {
      loopEndFrame = endFrame;
      while (currentOutputFrame < loopEndFrame) {
        assertNotAborted();

        const batch = buildCaptureFrameBatch(
          playableSegments,
          loopEndFrame,
          fps,
          currentOutputFrame,
          sourceDuration,
        );

        if (batch.frameIndices.length === 0) {
          break;
        }

        batchCount += 1;

        if (batch.mode === 'black') {
          for (let index = 0; index < batch.frameIndices.length; index += 1) {
            assertNotAborted();

            const frameIndex = batch.frameIndices[index];
            const outputTime = batch.outputTimes[index] ?? frameIndex / fps;

            // Reuse the pre-created black canvas — VideoFrame copies pixel data at
            // construction, so the same canvas can be encoded for every black frame.
            const encodeStartedAt = performance.now();
            await drainBeforeChunkStart(outputTime);
            encoder.encodeFrame(
              blackCanvas,
              toTimestampMicros(outputTime),
              isCaptureKeyFrame(frameIndex, fps),
            );
            await encoder.waitForEncoderCapacity(CAPTURE_MAX_PENDING_ENCODER_FRAMES);
            encodeMs += performance.now() - encodeStartedAt;
            if (encoderError) {
              throw encoderError;
            }

            currentOutputFrame += 1;
            blackFrameCount += 1;
            reportFrameProgress();
            await waitForWriterIfNeeded();

            if (currentOutputFrame % CAPTURE_YIELD_INTERVAL_FRAMES === 0) {
              await yieldAndRest();
            }
          }

          continue;
        }

        const frameIterator = videoFrameSource.framesAtTimestamps(batch.sourceTimes, signal);
        const cameraSourceTimes = cameraFrameSource
          ? batch.sourceTimes.map((time) => clampSourceTime(time, cameraFrameSource.duration))
          : null;
        const cameraFrameIterator =
          cameraFrameSource && cameraSourceTimes
            ? cameraFrameSource.framesAtTimestamps(cameraSourceTimes, signal)
            : null;

        try {
          for (let index = 0; index < batch.frameIndices.length; index += 1) {
            assertNotAborted();

            const frameIndex = batch.frameIndices[index];
            const outputTime = batch.outputTimes[index] ?? frameIndex / fps;
            const decodeStartedAt = performance.now();
            const [iteration, cameraIteration] = await Promise.all([
              withTimeout(frameIterator.next(), CAPTURE_STALL_TIMEOUT_MS, VIDEO_DECODE_STALL_ERROR),
              cameraFrameIterator
                ? withTimeout(
                    cameraFrameIterator.next(),
                    CAPTURE_STALL_TIMEOUT_MS,
                    VIDEO_DECODE_STALL_ERROR,
                  )
                : Promise.resolve(null),
            ]);
            decodeWaitMs += performance.now() - decodeStartedAt;

            if (iteration.done) {
              // Source exhausted before batch completed — drain PBOs and pad
              // remaining batch frames as black so the export completes cleanly.
              await drainAndEncodePending();
              for (let rem = index; rem < batch.frameIndices.length; rem += 1) {
                const remIdx = batch.frameIndices[rem];
                const remTime = batch.outputTimes[rem] ?? remIdx / fps;
                const encodeStart = performance.now();
                await drainBeforeChunkStart(remTime);
                encoder.encodeFrame(
                  blackCanvas,
                  toTimestampMicros(remTime),
                  isCaptureKeyFrame(remIdx, fps),
                );
                await encoder.waitForEncoderCapacity(CAPTURE_MAX_PENDING_ENCODER_FRAMES);
                encodeMs += performance.now() - encodeStart;
                currentOutputFrame += 1;
                blackFrameCount += 1;
              }
              break;
            }

            if (!iteration.value) {
              // Single null frame from decoder — drain PBOs and encode black.
              await drainAndEncodePending();
              const encodeStart = performance.now();
              await drainBeforeChunkStart(outputTime);
              encoder.encodeFrame(
                blackCanvas,
                toTimestampMicros(outputTime),
                isCaptureKeyFrame(frameIndex, fps),
              );
              await encoder.waitForEncoderCapacity(CAPTURE_MAX_PENDING_ENCODER_FRAMES);
              encodeMs += performance.now() - encodeStart;
              currentOutputFrame += 1;
              blackFrameCount += 1;
              continue;
            }

            const cameraRenderSource =
              cameraIteration && !cameraIteration.done ? cameraIteration.value : null;
            const renderStartedAt = performance.now();
            const frameSourceTime = batch.sourceTimes[index] ?? outputTime;
            drawFrame(frameSourceTime, outputTime, fixedDt, iteration.value, cameraRenderSource);
            renderMs += performance.now() - renderStartedAt;

            // Kick off async GPU→PBO transfer (non-blocking) then advance the pipeline.
            // Once PBO_SUB_BATCH frames are queued, drain all with a single gl.finish().
            initiateReadback(outputTime, isCaptureKeyFrame(frameIndex, fps));
            if (pendingPbos.length >= PBO_SUB_BATCH) {
              if (encoderError) {
                throw encoderError;
              }
              await drainAndEncodePending();
            }

            currentOutputFrame += 1;
            videoFrameCount += 1;
            if (cameraRenderSource) {
              cameraFrameCount += 1;
            }
            reportFrameProgress();
            await waitForWriterIfNeeded();

            if (currentOutputFrame % CAPTURE_YIELD_INTERVAL_FRAMES === 0) {
              await yieldAndRest();
            }
          }
        } finally {
          // Drain the pipeline: collect and encode all PBOs submitted in this batch
          // before iterators are closed and before the next batch (which may be black
          // frames that bypass the PBO path) starts encoding.
          if (!signal?.aborted) {
            await drainAndEncodePending();
          }
          pendingPbos.length = 0;
          await cameraFrameIterator?.return?.();
          await frameIterator.return?.();
        }
      }
    };

    // Simulates the stateful effects over [fromFrame, toFrame) without drawing,
    // exactly as a single pass would tick them, so a chunk that starts mid-way
    // begins in the same state.
    const warmableUpdaters = updaters.filter((updater) =>
      WARMUP_EFFECT_IDS.has(getPixiUpdaterEffectId(updater) ?? ''),
    );
    const warmUp = (fromFrame: number, toFrame: number): void => {
      let frame = fromFrame;
      while (frame < toFrame) {
        const batch = buildCaptureFrameBatch(playableSegments, toFrame, fps, frame, sourceDuration);
        if (batch.frameIndices.length === 0) {
          break;
        }
        if (batch.mode === 'video') {
          batch.frameIndices.forEach((frameIndex, index) => {
            const outputTime = batch.outputTimes[index] ?? frameIndex / fps;
            tickPixiPipeline(warmableUpdaters, batch.sourceTimes[index] ?? outputTime, fixedDt, {
              videoSource: null,
              cameraSource: null,
              outputTime,
            });
          });
        }
        frame = batch.frameIndices[batch.frameIndices.length - 1] + 1;
      }
    };

    const finishEncoder = async (): Promise<void> => {
      // Drain pending sequential IPC writes before the hardware-encoder flush.
      // The batchWriteQueue can have 1-2 writes queued when the frame loop ends.
      // Draining here (while still in "Capturing & encoding…") ensures that
      // encoder.flush() only needs to send the final hardware-pipeline output
      // (≤1 batch), keeping "Finalizing render…" short.
      const drainStartedAt = performance.now();
      await encoder.waitForPendingWrites(1);
      writerBackpressureMs += performance.now() - drainStartedAt;
      assertNotAborted();

      onProgress?.(CAPTURE_FLUSH_PROGRESS);
      assertNotAborted();
      const flushStartedAt = performance.now();
      await encoder.flush();
      encoderFlushMs += performance.now() - flushStartedAt;
      assertNotAborted();
      if (encoderError) {
        throw encoderError;
      }
    };

    try {
      if (runs === null) {
        await renderUntil(totalFrames);
        await finishEncoder();
      } else {
        for (const [runIndex, run] of runs.entries()) {
          assertNotAborted();
          if (run.startFrame > 0) {
            warmUp(Math.max(0, run.startFrame - warmupFrameCount(fps)), run.startFrame);
          }
          timestampOffsetSeconds = run.startFrame / fps;
          const onRunChunks = opts.onRunChunks;
          const onRunStart = opts.onRunStart;
          if (!onRunChunks || !onRunStart) {
            throw new Error('Chunked capture needs onRunStart and onRunChunks');
          }
          encoder = await createEncoder({
            onChunks: (chunks) => onRunChunks(runIndex, chunks),
            onConfig: (config) => onRunStart(runIndex, run, config),
          });
          encoderOpen = true;
          currentOutputFrame = run.startFrame;
          currentRunStartFrame = run.startFrame;
          await renderUntil(run.endFrame);
          await finishEncoder();
          encoderOpen = false;
          encoder.close();
          renderedInEarlierRuns += run.endFrame - run.startFrame;
          currentRunStartFrame = currentOutputFrame;
          await opts.onRunEnd?.(runIndex, run);
          assertNotAborted();
        }
      }
    } catch (error) {
      if (encoderOpen) {
        (encoder as VideoEncoderWrapper | undefined)?.close();
      }
      throw error;
    }

    const frameCount = runs ? renderedInEarlierRuns : currentOutputFrame;

    // ── Audio ──────────────────────────────────────────────────────────────
    // audioRenderMs is set when audio finishes; it renders alongside the video.
    const audioWavBuffer = await audioPromise;
    assertNotAborted();
    onProgress?.(CAPTURE_DONE_PROGRESS);

    const perfStats: ExportCapturePerfStats = {
      totalCaptureMs: performance.now() - captureStartedAt,
      decodeWaitMs,
      renderMs,
      gpuSyncMs,
      encodeMs,
      encoderFlushMs,
      writerBackpressureMs,
      audioRenderMs,
      restMs,
      batchCount,
      yieldedFrameCount,
      videoFrameCount,
      blackFrameCount,
      cameraFrameCount,
    };

    return { frameCount, audioWavBuffer, perfStats, ...(runs ? { runs } : {}) };
  } finally {
    cleanup();
  }
}
