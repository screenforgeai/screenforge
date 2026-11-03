import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/electron/renderer';
import { trackEvent } from '../lib/analytics';
import type {
  CaptureStoreSnapshot,
  CaptureWindowParams,
  ExportRuntimeStats,
  ExportSettings,
} from '../types';
import { useStore } from '../store';
import { createCaptureStoreSnapshot } from '../lib/export/captureSnapshot';
import { getCustomWallpaperUrl } from '../lib/effects/frame/wallpapers';
import { normalizeExportFpsForFormat } from '../lib/export/gif';
import { computeRequestedExportSize, computeTimelineDuration } from '../lib/export/planning';
import {
  estimateEncodedVideoBytes,
  isRandomAccessMuxFormat,
  resolveSupportedExportTarget,
} from '../lib/export/support';

export type ExportStatus = 'idle' | 'rendering' | 'encoding' | 'success' | 'error' | 'cancelled';

export interface ExportState {
  status: ExportStatus;
  progress: number;
  error: string | null;
  outputPath: string | null;
  resourceStats: ExportRuntimeStats | null;
  warnings: string[];
}

const INITIAL_STATE: ExportState = {
  status: 'idle',
  progress: 0,
  error: null,
  outputPath: null,
  resourceStats: null,
  warnings: [],
};

function smoothMetric(prev: number | null, next?: number): number | undefined {
  if (next == null || !Number.isFinite(next)) {
    return prev ?? undefined;
  }
  if (prev == null) {
    return next;
  }
  return prev * 0.7 + next * 0.3;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${Math.round(bytes / 1_000_000)} MB`;
  }
  if (bytes >= 1_000) {
    return `${Math.round(bytes / 1_000)} KB`;
  }
  return `${Math.round(bytes)} B`;
}

export function useVideoExport() {
  const [state, setState] = useState<ExportState>(INITIAL_STATE);
  const activeJobIdRef = useRef<string | null>(null);
  const cancelledJobIdsRef = useRef<Set<string>>(new Set());
  const smoothedCpuRef = useRef<number | null>(null);
  const smoothedMemRef = useRef<number | null>(null);
  const setIsExporting = useStore((s) => s.setIsExporting);

  useEffect(() => {
    setIsExporting(state.status === 'rendering' || state.status === 'encoding');
  }, [state.status, setIsExporting]);

  // Rendering-phase progress forwarded from the hidden capture window
  useEffect(() => {
    return window.screenforge.onCaptureProgress((value) => {
      setState((prev) =>
        prev.status === 'rendering'
          ? { ...prev, progress: Math.min(0.99, Math.max(0, value)) }
          : prev,
      );
    });
  }, []);

  useEffect(() => {
    return window.screenforge.onExportProgress((progress) => {
      if (progress.jobId !== activeJobIdRef.current) {
        return;
      }
      setState((prev) => ({
        ...prev,
        status: 'encoding',
        progress:
          progress.percent != null ? Math.min(0.98, Math.max(0, progress.percent)) : prev.progress,
      }));
    });
  }, []);

  useEffect(() => {
    if (state.status !== 'rendering' && state.status !== 'encoding') {
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async (): Promise<void> => {
      try {
        const stats = await window.screenforge.getExportStats(activeJobIdRef.current ?? undefined);
        if (!active) {
          return;
        }

        const cpu = smoothMetric(smoothedCpuRef.current, stats.cpuPercent);
        const memory = smoothMetric(smoothedMemRef.current, stats.memoryBytes);
        smoothedCpuRef.current = cpu ?? null;
        smoothedMemRef.current = memory ?? null;

        setState((prev) => ({
          ...prev,
          resourceStats: {
            ...stats,
            cpuPercent: cpu,
            memoryBytes: memory,
          },
        }));
      } catch {
        // Telemetry is non-blocking.
      } finally {
        if (active) {
          timer = setTimeout(() => void poll(), 750);
        }
      }
    };

    void poll();

    return () => {
      active = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [state.status]);

  const reset = useCallback(() => {
    smoothedCpuRef.current = null;
    smoothedMemRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  const cancelExport = useCallback(async () => {
    if (state.status !== 'rendering' && state.status !== 'encoding') {
      return;
    }
    const jobId = activeJobIdRef.current;
    if (!jobId) {
      return;
    }
    cancelledJobIdsRef.current.add(jobId);
    try {
      // cancelExport in service.ts aborts the hidden capture window (rendering phase)
      // and cancels the FFmpeg job (encoding phase) — works for both phases.
      await window.screenforge.cancelExport(jobId);
    } finally {
      activeJobIdRef.current = null;
      setState((prev) =>
        prev.status === 'rendering' || prev.status === 'encoding'
          ? { ...prev, status: 'cancelled', progress: 0, error: null, outputPath: null }
          : prev,
      );
    }
  }, [state.status]);

  const runExport = useCallback(async (outputPath: string, settings: ExportSettings) => {
    const {
      recordingResult,
      mediaSegments,
      frame,
      cursorClickSound,
      cursorClickSoundVolume,
      cursorEnabled,
      zoomClips,
      textClips,
      camera,
      keyboard,
      captions,
      cursorStyle,
      cursorSize,
      cursorClickEffect,
      cursorHalflife,
      cursorMotionBlur,
      cursorMaxTilt,
      cursorHideWhenIdle,
      cursorIdleHideSeconds,
      musicClips,
      cameraClips,
      maskClips,
    } = useStore.getState();
    if (!recordingResult) {
      throw new Error('No recording loaded');
    }

    smoothedCpuRef.current = null;
    smoothedMemRef.current = null;

    const jobId = `export-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    activeJobIdRef.current = jobId;

    let workspaceId: string | null = null;
    const assertNotCancelled = () => {
      if (cancelledJobIdsRef.current.has(jobId)) {
        throw new Error('Export cancelled');
      }
    };

    try {
      const sourceInfo = await window.screenforge.probeExportSource(recordingResult.filePath);
      assertNotCancelled();
      const effectiveFps = normalizeExportFpsForFormat(settings.format, settings.fps);
      const sourceFps =
        sourceInfo.fps != null && sourceInfo.fps > 0 ? sourceInfo.fps : effectiveFps;

      // Compute output dimensions by fitting the source canvas (which has the
      // frame geometry's actual aspect ratio, e.g. 16:10 from a MacBook display)
      // into the selected resolution's bounding box while preserving aspect ratio.
      // Fixed 16:9 targets would squish non-16:9 recordings.
      const srcW = sourceInfo.width ?? 1280;
      const srcH = sourceInfo.height ?? 800;
      const { width: requestedTargetWidth, height: requestedTargetHeight } =
        computeRequestedExportSize(frame, srcW, srcH, settings.resolution);
      const duration = computeTimelineDuration(recordingResult.duration, mediaSegments);

      const warnings: string[] = [];
      if (settings.format === 'gif' && effectiveFps !== settings.fps) {
        warnings.push(
          `GIF exports are normalized to ${effectiveFps} FPS for smoother playback across apps.`,
        );
      }

      const supportedTarget = await resolveSupportedExportTarget({
        format: settings.format,
        quality: settings.quality,
        resolution: settings.resolution,
        width: requestedTargetWidth,
        height: requestedTargetHeight,
        fps: effectiveFps,
      });

      if (!supportedTarget) {
        throw new Error(
          `This system cannot encode ${settings.format.toUpperCase()} exports at ${requestedTargetWidth}x${requestedTargetHeight} @ ${effectiveFps} FPS. Try a lower resolution or frame rate.`,
        );
      }

      if (supportedTarget.capped) {
        warnings.push(
          `Your system cannot encode ${requestedTargetWidth}x${requestedTargetHeight} for this export profile. Screenforge will cap the export to ${supportedTarget.width}x${supportedTarget.height}.`,
        );
      }

      if (isRandomAccessMuxFormat(settings.format)) {
        const estimatedVideoBytes = estimateEncodedVideoBytes(
          settings.quality,
          settings.resolution,
          duration,
        );
        if (estimatedVideoBytes >= 400_000_000) {
          warnings.push(
            `This ${settings.format.toUpperCase()} export may buffer about ${formatBytes(
              estimatedVideoBytes,
            )} of encoded video in memory before finalization. Longer high-resolution exports can use a lot of memory or fail.`,
          );
        }
      }

      trackEvent('export_started', {
        format: settings.format,
        resolution: settings.resolution,
        fps: effectiveFps,
        quality: settings.quality,
        has_audio: settings.includeAudio,
        duration_s: Math.round(duration),
      });

      setState({
        status: 'rendering',
        progress: 0,
        error: null,
        outputPath: null,
        resourceStats: null,
        warnings,
      });

      const workspace = await window.screenforge.createExportWorkspace(jobId);
      workspaceId = workspace.workspaceId;
      assertNotCancelled();

      // Snapshot the relevant Zustand store fields so the hidden capture window
      // can reconstruct the same rendering state without importing renderer modules.
      const captionsOverride =
        settings.burnCaptions && captions.segments.length > 0
          ? { ...captions, captionsEnabled: true }
          : undefined;
      const storeSnapshot: CaptureStoreSnapshot = createCaptureStoreSnapshot(
        {
          frame,
          zoomClips,
          textClips,
          camera,
          keyboard,
          cursorEnabled,
          cursorStyle,
          cursorSize,
          cursorClickEffect,
          cursorHalflife,
          cursorMotionBlur,
          cursorMaxTilt,
          cursorHideWhenIdle,
          cursorIdleHideSeconds,
          cameraClips,
          maskClips,
        },
        captionsOverride,
      );

      const captureParams: CaptureWindowParams = {
        workspaceId: workspaceId as string,
        jobId,
        recording: recordingResult,
        mediaSegments,
        frame,
        storeSnapshot,
        duration,
        fps: effectiveFps,
        sourceFps,
        targetWidth: supportedTarget.width,
        targetHeight: supportedTarget.height,
        format: settings.format,
        quality: settings.quality,
        resolution: settings.resolution,
        includeAudio: settings.includeAudio,
        cursor: {
          clickSound: cursorClickSound,
          clickSoundVolume: cursorClickSoundVolume,
        },
        customWallpaperDataUrl: getCustomWallpaperUrl(),
        musicClips: musicClips,
      };

      // Run captureTimeline() in a hidden BrowserWindow off the UI thread.
      // Progress is forwarded to the main window via onCaptureProgress subscription above.
      const captureResult = await window.screenforge.runCapture(captureParams);
      assertNotCancelled();

      // GIF has no audio track — skip writing audio even if includeAudio was set.
      if (
        workspaceId &&
        settings.includeAudio &&
        settings.format !== 'gif' &&
        captureResult.audioWavBuffer
      ) {
        await window.screenforge.writeExportAudio(workspaceId, captureResult.audioWavBuffer);
        assertNotCancelled();
      }

      setState((prev) => ({
        ...prev,
        status: 'encoding',
        progress: 0.02,
        error: null,
        outputPath: null,
      }));

      if (!workspaceId) {
        throw new Error('Export workspace was not created');
      }

      // startExport now calls finalizeMuxer internally on the main process side
      const result = await window.screenforge.startExport({
        jobId,
        workspaceId,
        effectiveFps,
        outputPath,
        settings,
      });
      assertNotCancelled();

      activeJobIdRef.current = null;
      setState((prev) => ({
        ...prev,
        status: 'success',
        progress: 1,
        error: null,
        outputPath: result.outputPath,
      }));
      trackEvent('export_completed', {
        format: settings.format,
        resolution: settings.resolution,
        fps: effectiveFps,
        quality: settings.quality,
        has_audio: settings.includeAudio,
        duration_s: Math.round(duration),
      });
      return result.outputPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      // Treat as cancellation when:
      //  - The user explicitly cancelled this job (cancelledJobIdsRef)
      //  - The error message mentions "cancel" (abort error from service)
      //  - The capture window was closed unexpectedly (app shutdown / process kill)
      const isCancelled =
        cancelledJobIdsRef.current.has(jobId) ||
        message.toLowerCase().includes('cancel') ||
        message.includes('closed unexpectedly');

      // Guard against clobbering a newer export that started while this one was
      // still cancelling. If a restart already set activeJobIdRef to a new jobId,
      // do not null it out and do not overwrite the new export's UI state.
      const isActiveJob = activeJobIdRef.current === jobId;
      if (isActiveJob) {
        activeJobIdRef.current = null;
      }

      if (workspaceId) {
        await window.screenforge.cleanupExportWorkspace(workspaceId).catch(() => undefined);
      }

      // If superseded by a newer export, exit silently so we don't clobber its state.
      if (!isActiveJob) {
        throw new Error('Export cancelled');
      }

      if (isCancelled) {
        trackEvent('export_cancelled', {
          format: settings.format,
          resolution: settings.resolution,
        });
      } else {
        Sentry.captureException(error, {
          tags: {
            error_type: 'export_failed',
            format: settings.format,
            resolution: settings.resolution,
          },
          extra: {
            quality: settings.quality,
            has_audio: settings.includeAudio,
            message,
          },
        });
        trackEvent('export_failed', {
          format: settings.format,
          resolution: settings.resolution,
          error: message,
        });
      }

      setState((prev) => ({
        ...prev,
        status: isCancelled ? 'cancelled' : 'error',
        progress: 0,
        error: isCancelled ? null : message,
        outputPath: null,
      }));
      throw isCancelled ? new Error('Export cancelled') : error;
    } finally {
      cancelledJobIdsRef.current.delete(jobId);
    }
  }, []);

  return {
    state,
    runExport,
    cancelExport,
    reset,
    isExporting: state.status === 'rendering' || state.status === 'encoding',
  };
}
