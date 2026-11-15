import { useEffect } from 'react';
import type { CaptureWindowParams, ProjectCursorSettings, TextClip } from '../types';
import type { CursorClickEffect, CursorClickSound, CursorStyle, FrameSettings } from '../store';
import { normalizeCursorEffect } from '../lib/effects/cursor/effects';
import type { MusicClip } from '../lib/timeline';
import type { ZoomClip, MediaSegment, CameraClip, MaskClip } from '../types/timeline';
import { captureTimeline } from '../lib/export/captureTimeline';
import { createChunkedCaptureHooks } from '../lib/export/chunkedCapture';
import { setCustomWallpaperUrl } from '../lib/effects/frame/wallpapers';
import { useStore } from '../store';
import { normalizeMotionClips } from '../lib/animation/motionClips';

const ExportWorker = () => {
  useEffect(() => {
    // Subscribe to capture params, then signal readiness so the main process
    // sends CAPTURE_PARAMS only after this listener is guaranteed to be live.
    const unsubscribeParams = window.screenforge.onCaptureParams((params: CaptureWindowParams) => {
      const controller = new AbortController();
      const unsubscribeAbort = window.screenforge.onCaptureAbort(() => {
        controller.abort();
      });

      // Populate this window's fresh Zustand store so effect draw callbacks
      // (cursor render, camera draw, zoom interpolation) read correct settings.
      const snap = params.storeSnapshot;
      useStore.setState({
        frame: snap.frame as FrameSettings,
        zoomClips: snap.zoomClips as ZoomClip[],
        textClips: snap.textClips as TextClip[],
        mediaSegments: params.mediaSegments as MediaSegment[],
        camera: snap.camera,
        keyboard: snap.keyboard,
        ...(snap.captions ? { captions: snap.captions } : {}),
        cursorEnabled: snap.cursorEnabled,
        cursorStyle: snap.cursorStyle as CursorStyle,
        cursorSize: snap.cursorSize,
        cursorClickEffect: snap.cursorClickEffect as CursorClickEffect,
        cursorHalflife: snap.cursorHalflife,
        cursorMotionBlur: snap.cursorMotionBlur,
        cursorMaxTilt: snap.cursorMaxTilt,
        cursorHideWhenIdle: snap.cursorHideWhenIdle,
        cursorIdleHideSeconds: snap.cursorIdleHideSeconds,
        cursorEffect: normalizeCursorEffect(snap.cursorEffect),
        cursorClickShrink: snap.cursorClickShrink,
        cursorColor: snap.cursorColor,
        cursorLabel: snap.cursorLabel,
        cameraClips: snap.cameraClips as CameraClip[],
        maskClips: snap.maskClips as MaskClip[],
        motionClips: normalizeMotionClips(snap.motionClips),
        isCropEditing: false,
        // The window bar reads the recorded window's title from it.
        recordingResult: params.recording,
      });

      // Register custom wallpaper data URL so the export window can render it.
      setCustomWallpaperUrl(params.customWallpaperDataUrl ?? null);

      // Chunked export renders only the chunks missing from the cache; a
      // pre-render fills the cache and reports how much of it is ready.
      const isPrerender = params.chunking === 'prerender';
      // Chunks cached when the plan was made, the latest confirmed count (after
      // each run), and the last count reported.
      let total = 0;
      let cachedAtPlan = -1;
      let confirmedCached = 0;
      let reportedCached = -1;
      const reportPrerender = (
        phase: 'planned' | 'rendering' | 'done' | 'failed',
        cached = confirmedCached,
      ) => {
        if (isPrerender) {
          // A failed run may have stopped short of a chunk the estimate counted.
          reportedCached = phase === 'failed' ? cached : Math.max(reportedCached, cached);
          window.screenforge.reportPrerenderStatus({
            phase,
            total,
            cached: reportedCached,
            stateVersion: params.stateVersion ?? 0,
          });
        }
      };
      const chunked = params.chunking
        ? createChunkedCaptureHooks(params, window.screenforge, (progress) => {
            total = progress.total;
            confirmedCached = progress.cached;
            if (cachedAtPlan < 0) {
              cachedAtPlan = progress.cached;
              reportPrerender(progress.cached >= progress.total ? 'done' : 'planned');
            } else {
              reportPrerender('rendering');
            }
          })
        : null;
      // Between runs, estimate finished chunks from frame progress so the
      // editor's readiness moves chunk by chunk (never ahead by a full chunk).
      const reportFrameProgress = (value: number) => {
        if (!isPrerender || cachedAtPlan < 0) {
          return;
        }
        const missing = total - cachedAtPlan;
        const estimate = cachedAtPlan + Math.floor(Math.min(1, value / 0.96) * missing);
        if (estimate > reportedCached && estimate < total) {
          reportPrerender('rendering', estimate);
        }
      };

      const captureStartedAt = performance.now();
      captureTimeline({
        recording: params.recording,
        mediaSegments: params.mediaSegments as MediaSegment[],
        frame: snap.frame as FrameSettings,
        duration: params.duration,
        fps: params.fps,
        sourceFps: params.sourceFps,
        targetWidth: params.targetWidth,
        targetHeight: params.targetHeight,
        format: params.format,
        quality: params.quality,
        resolution: params.resolution,
        includeAudio: params.includeAudio,
        cursor: params.cursor as Pick<ProjectCursorSettings, 'clickSound' | 'clickSoundVolume'> & {
          clickSound: CursorClickSound;
        },
        musicClips: (params.musicClips as MusicClip[]) ?? [],
        signal: controller.signal,
        onProgress: (value) => {
          window.screenforge.notifyCaptureProgress(value);
          reportFrameProgress(value);
        },
        ...(chunked
          ? {
              planRuns: chunked.planRuns,
              onRunStart: chunked.onRunStart,
              onRunChunks: chunked.onRunChunks,
              onRunEnd: chunked.onRunEnd,
              skipAudio: isPrerender,
              dutyCycle: isPrerender ? params.dutyCycle : undefined,
            }
          : {}),
        onChunk: (chunks) => window.screenforge.writeEncodedChunks(params.workspaceId, chunks),
        onInitMuxer: (decoderConfig) => {
          // GIF uses a temp MP4 during the WebCodecs phase; palette conversion is in FFmpeg.
          const muxerFormat = params.format === 'gif' ? 'mp4' : params.format;
          return window.screenforge.initMuxer(
            params.workspaceId,
            muxerFormat,
            decoderConfig,
            params.targetWidth,
            params.targetHeight,
            params.fps,
          );
        },
      })
        .then((result) => {
          const totalMs = Math.round(performance.now() - captureStartedAt);
          const s = result.perfStats;
          if (s) {
            window.screenforge.writeDiagnosticLog('export:capture:perf', {
              totalMs,
              frames: s.videoFrameCount + s.blackFrameCount,
              videoFrames: s.videoFrameCount,
              blackFrames: s.blackFrameCount,
              batches: s.batchCount,
              // Phase breakdown (ms):
              decodeWaitMs: Math.round(s.decodeWaitMs),
              renderMs: Math.round(s.renderMs),
              readPixelsYFlipMs: Math.round(s.gpuSyncMs),
              encodeMs: Math.round(s.encodeMs),
              // Time in encoder.flush() AFTER pre-flush drain:
              encoderFlushMs: Math.round(s.encoderFlushMs),
              // In-loop backpressure waits + pre-flush drain combined:
              writerBackpressureMs: Math.round(s.writerBackpressureMs),
              audioRenderMs: Math.round(s.audioRenderMs),
              // Unaccounted = GC, yields, IPC round-trip overhead, etc.
              unaccountedMs: Math.round(
                totalMs -
                  s.decodeWaitMs -
                  s.renderMs -
                  s.encodeMs -
                  s.encoderFlushMs -
                  s.writerBackpressureMs -
                  s.audioRenderMs,
              ),
            });
          }
          reportPrerender('done');
          window.screenforge.notifyCaptureDone({
            frameCount: result.frameCount,
            audioWavBuffer: result.audioWavBuffer,
            perfStats: result.perfStats,
            ...(chunked ? { chunkKeys: chunked.keys(), chunkStats: chunked.stats() } : {}),
          });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : 'Capture failed';
          reportPrerender('failed');
          window.screenforge.notifyCaptureError(message);
        })
        .finally(() => {
          unsubscribeAbort();
        });
    });

    // Signal to the main process that our listener is now registered and ready.
    window.screenforge.notifyCaptureReady();

    return () => unsubscribeParams();
  }, []);

  return null;
};

export default ExportWorker;
