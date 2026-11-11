/**
 * captureWorker.ts — OffscreenCanvas worker for export compositing + encoding.
 *
 * Runs the full effects pipeline (cursor, frame, zoom) and VideoEncoder on a
 * background thread so the main renderer UI stays responsive during export.
 *
 * Message protocol (main → worker):
 *   init        — one-time setup: store snapshot, effects data, wallpapers
 *   frame       — per output frame: source ImageBitmap + camera ImageBitmap
 *   flush       — signal that all frames have been sent; finalize encoding
 *   cancel      — abort immediately
 *
 * Message protocol (worker → main):
 *   init_muxer  — VideoDecoderConfig available; main must call initMuxer IPC
 *   muxer_ack   — (main sends this back) muxer is ready; worker can send chunks
 *   chunks      — batch of encoded video chunks for the main process muxer
 *   frame_ack   — frame processing complete; main may send the next frame
 *   done        — all chunks flushed; export complete
 *   error       — unrecoverable error
 */

import { drawCameraExportFrame } from '../effects/camera/index';
import { buildEffectPipeline, drawEffectPipeline } from '../effects/pipeline';
import { setWallpaperBitmaps } from '../effects/frame/wallpapers';
import { useStore } from '../../store';
import { VideoEncoderWrapper } from './videoEncoder';
import type {
  ExportFormat,
  ExportQuality,
  ExportResolution,
  SerializedChunk,
  SerializedDecoderConfig,
  ProjectCameraSettings,
  ProjectCursorSettings,
  CursorStyle,
  CursorClickEffect,
} from '../../types/index';
import type { CursorEffect } from '../effects/cursor/effects';
import type { ZoomClip } from '../../types/timeline';
import type { FrameSettings } from '../effects/frame';

// ── Shared message types (imported by captureTimeline too) ─────────────────

export interface WorkerStoreSnapshot {
  frame: FrameSettings;
  zoomClips: ZoomClip[];
  camera: ProjectCameraSettings;
  cursorEnabled: boolean;
  // Cursor fields read per-frame in cursor/render.ts
  cursorStyle: CursorStyle;
  cursorSize: number;
  cursorClickEffect: CursorClickEffect;
  cursorHalflife: number;
  cursorMotionBlur: boolean;
  cursorMaxTilt: number;
  cursorHideWhenIdle: boolean;
  cursorIdleHideSeconds: number;
  cursorEffect: CursorEffect;
  cursorClickShrink: boolean;
  cursorColor: string;
  cursorLabel: string;
  cursor: ProjectCursorSettings;
}

export interface WorkerInitMessage {
  type: 'init';
  sourceCanvasWidth: number;
  sourceCanvasHeight: number;
  drawSourceWidth: number;
  drawSourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  format: ExportFormat;
  quality: ExportQuality;
  resolution: ExportResolution;
  fps: number;
  totalFrames: number;
  fixedDt: number;
  storeSnapshot: WorkerStoreSnapshot;
  /** Serialised analysed effect data (Map<string, unknown> as plain object). */
  analyzedData: Record<string, unknown>;
  /** Wallpaper URL → ImageBitmap for drawWallpaper in worker context. */
  wallpaperBitmaps: Record<string, ImageBitmap>;
}

export interface WorkerFrameMessage {
  type: 'frame';
  /** Raw source frame. Null for gap/black frames. */
  sourceBitmap: ImageBitmap | null;
  /** Camera frame (already seeked on main thread). Null if camera disabled. */
  cameraBitmap: ImageBitmap | null;
  timelineTime: number;
  timestampMicros: number;
  isKeyFrame: boolean;
  isBlackFrame: boolean;
}

export type WorkerInMessage =
  | WorkerInitMessage
  | WorkerFrameMessage
  | { type: 'flush' }
  | { type: 'cancel' }
  | { type: 'muxer_ready' };

// ── Worker state ───────────────────────────────────────────────────────────

let encoder: VideoEncoderWrapper | null = null;
let sourceCanvas: OffscreenCanvas | null = null;
let outputCanvas: OffscreenCanvas | null = null;
let srcCtx: OffscreenCanvasRenderingContext2D | null = null;
let outCtx: OffscreenCanvasRenderingContext2D | null = null;
let drawSourceWidth = 0;
let drawSourceHeight = 0;
let canvasWidth = 0;
let canvasHeight = 0;
let targetWidth = 0;
let targetHeight = 0;
let fixedDt = 0;
let frameCount = 0;

let contentLayers: ReturnType<typeof buildEffectPipeline>['contentLayers'] = [];
let frameWrappers: ReturnType<typeof buildEffectPipeline>['frameWrappers'] = [];
let overlayLayers: ReturnType<typeof buildEffectPipeline>['overlayLayers'] = [];

// Promise machinery for awaiting muxer_ready from the main thread
let muxerReadyResolve: (() => void) | null = null;

// ── Main message dispatcher ────────────────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      handleInit(msg);
      break;
    case 'frame':
      handleFrame(msg);
      break;
    case 'flush':
      void handleFlush();
      break;
    case 'muxer_ready':
      muxerReadyResolve?.();
      muxerReadyResolve = null;
      break;
    case 'cancel':
      encoder?.close();
      break;
  }
};

// ── Init ───────────────────────────────────────────────────────────────────

function handleInit(msg: WorkerInitMessage): void {
  drawSourceWidth = msg.drawSourceWidth;
  drawSourceHeight = msg.drawSourceHeight;
  canvasWidth = msg.sourceCanvasWidth;
  canvasHeight = msg.sourceCanvasHeight;
  targetWidth = msg.targetWidth;
  targetHeight = msg.targetHeight;
  fixedDt = msg.fixedDt;

  // Populate the worker's Zustand store with the main-thread snapshot so that
  // effects calling useStore.getState() see the user's current settings.
  useStore.setState({
    frame: msg.storeSnapshot.frame,
    zoomClips: msg.storeSnapshot.zoomClips,
    camera: msg.storeSnapshot.camera,
    keyboard: msg.storeSnapshot.keyboard,
    cursorEnabled: msg.storeSnapshot.cursorEnabled,
    cursorStyle: msg.storeSnapshot.cursorStyle,
    cursorSize: msg.storeSnapshot.cursorSize,
    cursorClickEffect: msg.storeSnapshot.cursorClickEffect,
    cursorHalflife: msg.storeSnapshot.cursorHalflife,
    cursorMotionBlur: msg.storeSnapshot.cursorMotionBlur,
    cursorMaxTilt: msg.storeSnapshot.cursorMaxTilt,
    cursorHideWhenIdle: msg.storeSnapshot.cursorHideWhenIdle,
    cursorIdleHideSeconds: msg.storeSnapshot.cursorIdleHideSeconds,
    cursorEffect: msg.storeSnapshot.cursorEffect,
    cursorClickShrink: msg.storeSnapshot.cursorClickShrink,
    cursorColor: msg.storeSnapshot.cursorColor,
    cursorLabel: msg.storeSnapshot.cursorLabel,
    cursor: msg.storeSnapshot.cursor,
    isCropEditing: false,
  });

  // Register wallpaper ImageBitmaps for drawWallpaper.
  setWallpaperBitmaps(new Map(Object.entries(msg.wallpaperBitmaps)));

  // Set up canvases.
  sourceCanvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  outputCanvas = new OffscreenCanvas(targetWidth, targetHeight);
  srcCtx = sourceCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  outCtx = outputCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  if (outCtx) {
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
  }

  // Reconstruct analysed data Map from the serialised record.
  const analyzedData = new Map<string, unknown>(Object.entries(msg.analyzedData));

  ({ contentLayers, overlayLayers, frameWrappers } = buildEffectPipeline(analyzedData, {
    // Camera is handled separately from per-frame ImageBitmaps.
    excludeEffects: new Set(['camera']),
  }));

  // Create the VideoEncoder.
  VideoEncoderWrapper.create({
    format: msg.format,
    quality: msg.quality,
    resolution: msg.resolution,
    width: targetWidth,
    height: targetHeight,
    fps: msg.fps,
    onChunkBatch: async (chunks: SerializedChunk[]) => {
      self.postMessage({ type: 'chunks', chunks });
    },
    onDecoderConfig: async (config: SerializedDecoderConfig) => {
      // Tell the main thread to call initMuxer; wait for its confirmation.
      self.postMessage({ type: 'init_muxer', config });
      await new Promise<void>((resolve) => {
        muxerReadyResolve = resolve;
      });
    },
    onError: (err: Error) => {
      self.postMessage({ type: 'error', message: err.message });
    },
  })
    .then(({ wrapper, decoderConfig }) => {
      encoder = wrapper;
      if (decoderConfig !== null) {
        // Pre-flight config available immediately — tell main to init muxer.
        self.postMessage({ type: 'init_muxer', config: decoderConfig });
        // Wait for muxer_ready before marking ready (deferred via promise).
        new Promise<void>((resolve) => {
          muxerReadyResolve = resolve;
        }).then(() => {
          encoder?.markMuxerReady();
        });
      }
      self.postMessage({ type: 'encoder_ready' });
    })
    .catch((err: unknown) => {
      self.postMessage({ type: 'error', message: String(err) });
    });
}

// ── Frame ──────────────────────────────────────────────────────────────────

function handleFrame(msg: WorkerFrameMessage): void {
  if (!encoder || !srcCtx || !outCtx || !sourceCanvas || !outputCanvas) {
    self.postMessage({ type: 'error', message: 'Worker received frame before init' });
    return;
  }

  try {
    if (msg.isBlackFrame || !msg.sourceBitmap) {
      srcCtx.fillStyle = '#000';
      srcCtx.fillRect(0, 0, canvasWidth, canvasHeight);
      outCtx.fillStyle = '#000';
      outCtx.fillRect(0, 0, targetWidth, targetHeight);
    } else {
      drawFrame(msg.sourceBitmap, msg.cameraBitmap, msg.timelineTime);
    }

    encoder.encodeFrame(outputCanvas, msg.timestampMicros, msg.isKeyFrame);
    frameCount += 1;
  } finally {
    msg.sourceBitmap?.close();
    msg.cameraBitmap?.close();
  }

  // Signal main thread that this frame is done and the next can be sent.
  self.postMessage({ type: 'frame_ack' });
}

function drawFrame(
  sourceBitmap: ImageBitmap,
  cameraBitmap: ImageBitmap | null,
  timelineTime: number,
): void {
  if (!srcCtx || !outCtx || !sourceCanvas || !outputCanvas) {
    return;
  }
  // Local aliases so TypeScript doesn't re-check nullability inside closures.
  const sc = srcCtx;
  const oc = outCtx;
  const canvas = sourceCanvas;

  sc.clearRect(0, 0, canvasWidth, canvasHeight);
  const renderContext = {
    videoSource: {
      source: sourceBitmap,
      width: sourceBitmap.width,
      height: sourceBitmap.height,
      ready: true,
    },
    cameraSource: cameraBitmap
      ? {
          source: cameraBitmap,
          width: cameraBitmap.width,
          height: cameraBitmap.height,
          ready: true,
        }
      : null,
  };

  drawEffectPipeline({
    ctx: sc,
    t: timelineTime,
    dt: fixedDt,
    sourceWidth: drawSourceWidth,
    sourceHeight: drawSourceHeight,
    canvasWidth,
    canvasHeight,
    contentLayers,
    overlayLayers,
    frameWrappers,
    renderContext,
    drawBase: () => {
      sc.drawImage(sourceBitmap, 0, 0, drawSourceWidth, drawSourceHeight);
    },
  });

  drawCameraExportFrame(sc, canvasWidth, canvasHeight, timelineTime, renderContext);

  // Downscale source to output resolution.
  oc.clearRect(0, 0, targetWidth, targetHeight);
  oc.drawImage(canvas, 0, 0, targetWidth, targetHeight);
}

// ── Flush ──────────────────────────────────────────────────────────────────

async function handleFlush(): Promise<void> {
  if (!encoder) {
    self.postMessage({ type: 'done', frameCount });
    return;
  }
  try {
    await encoder.flush();
    self.postMessage({ type: 'done', frameCount });
  } catch (err: unknown) {
    self.postMessage({ type: 'error', message: String(err) });
  }
}
