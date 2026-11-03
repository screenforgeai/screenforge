import type {
  ExportFormat,
  ExportQuality,
  ExportResolution,
  SerializedChunk,
  SerializedDecoderConfig,
} from '../../types/index';
import { resolveSupportedVideoEncoderConfig } from './support';

const ENCODED_CHUNK_BATCH_SIZE = 60;
// batchWriteQueue serializes IPC sends — short timer so chunks are forwarded
// to the muxer quickly, reducing startup latency and keeping IPC write pressure steady.
const ENCODED_CHUNK_BATCH_DELAY_MS = 100;

function serializeDecoderConfig(
  config: VideoDecoderConfig,
  fallbackWidth: number,
  fallbackHeight: number,
): SerializedDecoderConfig {
  const description = config.description;

  return {
    codec: config.codec,
    codedWidth: config.codedWidth ?? fallbackWidth,
    codedHeight: config.codedHeight ?? fallbackHeight,
    displayAspectWidth: config.displayAspectWidth,
    displayAspectHeight: config.displayAspectHeight,
    description:
      description instanceof ArrayBuffer
        ? description
        : description
          ? (description as ArrayBufferView).buffer.slice(
              (description as ArrayBufferView).byteOffset,
              (description as ArrayBufferView).byteOffset +
                (description as ArrayBufferView).byteLength,
            )
          : undefined,
  };
}

// ── Public types ───────────────────────────────────────────────────────────

export interface VideoEncoderWrapperOptions {
  format: ExportFormat;
  quality: ExportQuality;
  resolution: ExportResolution;
  width: number;
  height: number;
  fps: number;
  /** Called with each batch of encoded chunks ready to send to main process. */
  onChunkBatch: (chunks: SerializedChunk[]) => Promise<void>;
  /**
   * Called once when the VideoDecoderConfig becomes available (may be deferred
   * to first keyframe if isConfigSupported returned null decoderConfig).
   * Implementer should call initMuxer IPC here.
   */
  onDecoderConfig: (config: SerializedDecoderConfig) => Promise<void>;
  /** Called if the encoder encounters a hardware error. */
  onError: (err: Error) => void;
}

export interface CreateEncoderResult {
  wrapper: VideoEncoderWrapper;
  /**
   * Non-null when isConfigSupported() returned it — caller can initMuxer immediately.
   * Null when not available up-front — onDecoderConfig will fire on first keyframe.
   */
  decoderConfig: SerializedDecoderConfig | null;
}

// ── VideoEncoderWrapper ────────────────────────────────────────────────────

export class VideoEncoderWrapper {
  private readonly encoder: VideoEncoder;
  private readonly opts: VideoEncoderWrapperOptions;
  private readonly keyframeInterval: number;
  private pendingChunks: SerializedChunk[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private faulted = false;
  private muxerReady = false;
  private bufferedBeforeMuxer: SerializedChunk[] = [];
  private flushResolvers: Array<() => void> = [];
  private encoderDrainResolvers: Array<() => void> = [];
  private pendingEncodes = 0;
  private batchWriteQueue: Promise<void> = Promise.resolve();
  private batchWriteError: Error | null = null;
  private pendingBatchWrites = 0;
  private muxerInitPromise: Promise<void> | null = null;

  private constructor(encoder: VideoEncoder, opts: VideoEncoderWrapperOptions) {
    this.encoder = encoder;
    this.opts = opts;
    this.keyframeInterval = Math.round(opts.fps) * 2; // 2-second GOP
  }

  /** Factory — runs isConfigSupported pre-flight. Throws if encoder unsupported. */
  static async create(opts: VideoEncoderWrapperOptions): Promise<CreateEncoderResult> {
    // VP9 (WebM) has no hardware encoder on macOS — VideoToolbox only accelerates
    // H.264/HEVC. Use software encoding for VP9 and variable bitrate (CBR is not
    // guaranteed to be supported by software VP9 implementations).
    const isVp9 = opts.format === 'webm';

    const resolvedConfig = await resolveSupportedVideoEncoderConfig({
      format: opts.format,
      quality: opts.quality,
      resolution: opts.resolution,
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
    });

    if (!resolvedConfig) {
      throw new Error(
        isVp9
          ? 'VP9 software encoding is not available — please update Electron'
          : 'H.264 video encoding is not available — please update your system drivers or Electron',
      );
    }

    let preflight: SerializedDecoderConfig | null = null;
    if (resolvedConfig.config.decoderConfig) {
      preflight = serializeDecoderConfig(
        resolvedConfig.config.decoderConfig,
        opts.width,
        opts.height,
      );
    }

    // Use a definite-assignment assertion so encoder callbacks can close over `wrapper`.
    // Output callbacks are asynchronous and never fire before the constructor returns.
    // eslint-disable-next-line prefer-const
    let wrapper!: VideoEncoderWrapper;
    const realEncoder = new VideoEncoder({
      output: (chunk, meta) => wrapper.handleOutput(chunk, meta ?? undefined),
      error: (err) => wrapper.handleError(err),
    });
    realEncoder.configure(resolvedConfig.config as VideoEncoderConfig);
    wrapper = new VideoEncoderWrapper(realEncoder, opts);

    return { wrapper, decoderConfig: preflight };
  }

  private handleOutput(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void {
    // Decrement unconditionally — every encodeFrame() increments pendingEncodes once.
    // Moving this to the top ensures flush() never deadlocks in the buffered/lazy path.
    this.pendingEncodes -= 1;

    const data = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(data);

    const serialized: SerializedChunk = {
      data,
      type: chunk.type,
      timestamp: chunk.timestamp,
      duration: chunk.duration ?? Math.round(1_000_000 / this.opts.fps),
    };

    // Lazy decoderConfig path: fire onDecoderConfig on the first keyframe
    if (!this.muxerReady && chunk.type === 'key' && meta?.decoderConfig) {
      const serializedDc = serializeDecoderConfig(
        meta.decoderConfig,
        this.opts.width,
        this.opts.height,
      );
      this.muxerReady = true;
      // Fire initMuxer, then flush everything in the correct decode order.
      this.muxerInitPromise = this.opts
        .onDecoderConfig(serializedDc)
        .then(async () => {
          // The encoder can produce chunks while this async IPC call is
          // in-flight. Because muxerReady was set synchronously above, those
          // chunks are in pendingChunks and belong after the triggering keyframe.
          const buffered = this.bufferedBeforeMuxer;
          this.bufferedBeforeMuxer = [];

          const pendingAfterInit = this.pendingChunks;
          this.pendingChunks = [];
          if (this.batchTimer !== null) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
          }

          const allChunks = [...buffered, serialized, ...pendingAfterInit];
          if (allChunks.length > 0) {
            await this.queueBatchWrite(allChunks);
          }
        })
        .catch((err: unknown) => {
          this.batchWriteError = err instanceof Error ? err : new Error(String(err));
        })
        .finally(() => {
          this.resolveFlushIfDone();
        });
      return;
    }

    if (!this.muxerReady) {
      // Still waiting for decoderConfig — buffer this chunk
      this.bufferedBeforeMuxer.push(serialized);
      this.resolveFlushIfDone();
      return;
    }

    this.addToBatch(serialized);
    this.resolveFlushIfDone();
    this.notifyEncoderDrainWaiters();
  }

  private resolveFlushIfDone(): void {
    if (this.pendingEncodes === 0 && this.flushResolvers.length > 0) {
      const resolvers = this.flushResolvers;
      this.flushResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  private notifyEncoderDrainWaiters(): void {
    if (this.encoderDrainResolvers.length === 0) {
      return;
    }
    const resolvers = this.encoderDrainResolvers;
    this.encoderDrainResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  }

  private handleError(err: DOMException): void {
    this.faulted = true;
    this.opts.onError(new Error(`VideoEncoder error: ${err.message}`));
  }

  private addToBatch(chunk: SerializedChunk): void {
    this.pendingChunks.push(chunk);
    if (this.pendingChunks.length >= ENCODED_CHUNK_BATCH_SIZE) {
      void this.flushBatch();
    } else if (this.batchTimer === null) {
      this.batchTimer = setTimeout(() => {
        void this.flushBatch();
      }, ENCODED_CHUNK_BATCH_DELAY_MS);
    }
  }

  private flushBatch(): Promise<void> {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.pendingChunks.length === 0) {
      return Promise.resolve();
    }
    const batch = this.pendingChunks;
    this.pendingChunks = [];
    return this.queueBatchWrite(batch);
  }

  private queueBatchWrite(chunks: SerializedChunk[]): Promise<void> {
    this.pendingBatchWrites += 1;
    const write = this.batchWriteQueue.then(() => this.opts.onChunkBatch(chunks));
    this.batchWriteQueue = write
      .catch((err: unknown) => {
        this.batchWriteError = err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => {
        this.pendingBatchWrites = Math.max(0, this.pendingBatchWrites - 1);
      });
    return this.batchWriteQueue;
  }

  /**
   * Encode one frame from a canvas source.
   * Used for black frames (2D canvas). Video frames use encodePixelBuffer instead.
   */
  encodeFrame(
    source: HTMLCanvasElement | OffscreenCanvas,
    timestampMicros: number,
    isKeyFrame: boolean,
  ): void {
    if (this.faulted) {
      throw new Error('VideoEncoder is in an error state — export aborted');
    }
    this.pendingEncodes += 1;
    const frame = new VideoFrame(source, { timestamp: timestampMicros });
    try {
      this.encoder.encode(frame, { keyFrame: isKeyFrame });
    } finally {
      frame.close();
    }
  }

  /**
   * Encode one frame from a CPU pixel buffer (top-to-bottom RGBA).
   *
   * Preferred over encodeFrame(canvas) for video frames: VideoToolbox reads
   * CPU memory instead of the WebGL canvas IOSurface, eliminating the Metal
   * cross-queue fence that caused gl.readPixels to block ~31ms/frame waiting
   * for VideoToolbox to release the IOSurface.
   */
  encodePixelBuffer(
    pixels: Uint8Array,
    width: number,
    height: number,
    timestampMicros: number,
    isKeyFrame: boolean,
  ): void {
    if (this.faulted) {
      throw new Error('VideoEncoder is in an error state — export aborted');
    }
    this.pendingEncodes += 1;
    const frame = new VideoFrame(pixels, {
      format: 'RGBA',
      codedWidth: width,
      codedHeight: height,
      timestamp: timestampMicros,
      // sRGB full-range color space metadata. Screen content is rendered in sRGB
      // (iec61966-2-1 transfer) with full 0–255 range. Providing explicit color
      // space prevents the encoder from assuming limited-range BT.601 and applying
      // an incorrect color space conversion that would shift colors in the output.
      colorSpace: {
        primaries: 'bt709',
        transfer: 'iec61966-2-1',
        matrix: 'rgb',
        fullRange: true,
      },
    });
    try {
      this.encoder.encode(frame, { keyFrame: isKeyFrame });
    } finally {
      frame.close();
    }
  }

  /** Mark muxer as ready (used when decoderConfig was obtained from isConfigSupported pre-flight). */
  markMuxerReady(): void {
    this.muxerReady = true;
  }

  async waitForPendingWrites(maxPendingBatches = 3): Promise<void> {
    if (this.batchWriteError) {
      throw this.batchWriteError;
    }
    // Loop: snapshot the current tail of the queue, await it, then re-check the
    // count. This ensures we only wait long enough to drop below the threshold
    // rather than draining ALL batches (which the old `await this.batchWriteQueue`
    // did — causing 127 s encoder-flush stalls when the encoder outpaced IPC).
    while (this.pendingBatchWrites >= maxPendingBatches) {
      const snapshot = this.batchWriteQueue;
      await snapshot;
      if (this.batchWriteError) {
        throw this.batchWriteError;
      }
    }
  }

  /** Flush all pending encodes and batched chunks. Resolves when all output callbacks fire. */
  async flush(): Promise<void> {
    if (this.faulted) {
      return;
    }
    if (this.pendingEncodes > 0) {
      await new Promise<void>((resolve) => {
        this.flushResolvers.push(resolve);
        void this.encoder.flush();
      });
    } else {
      await this.encoder.flush();
    }
    await this.muxerInitPromise;
    await this.flushBatch();
    await this.batchWriteQueue;
    if (this.batchWriteError) {
      throw this.batchWriteError;
    }
  }

  /**
   * Wait until the hardware encoder has fewer than `maxPendingEncodes` frames
   * buffered. Call this after each encodeFrame() to bound how far the frame
   * loop can get ahead of the hardware encoder. Without backpressure, all
   * frames accumulate in the encoder and flush() blocks for the full encoding
   * duration (60–120 s). Bounded to 2 s per wait as a stall safety net.
   *
   * After 5 consecutive timeouts (~10 s of stalling with no encoder output),
   * the encoder is considered frozen and onError is fired so the export fails
   * fast rather than hanging indefinitely.
   */
  async waitForEncoderCapacity(maxPendingEncodes: number): Promise<void> {
    let consecutiveTimeouts = 0;
    while (this.pendingEncodes > maxPendingEncodes) {
      const drained = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 2_000);
        this.encoderDrainResolvers.push(() => {
          clearTimeout(timer);
          resolve(true);
        });
      });

      if (!drained) {
        consecutiveTimeouts += 1;
        if (consecutiveTimeouts >= 5) {
          this.handleError(
            new DOMException(
              `VideoEncoder stalled: no output for ${consecutiveTimeouts * 2}s ` +
                `(pendingEncodes=${this.pendingEncodes}). ` +
                'The encoder produced no output; this can be caused by GPU/canvas readback, ' +
                'encoder backpressure, or an unsupported encoder mode.',
              'EncodingError',
            ),
          );
          return;
        }
      } else {
        consecutiveTimeouts = 0;
      }
    }
  }

  /** Close the encoder without flushing (used on cancel). */
  close(): void {
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
    }
    this.encoder.close();
    // Unblock any waitForEncoderCapacity calls so the frame loop can exit.
    this.notifyEncoderDrainWaiters();
  }
}
