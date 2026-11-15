import { useCallback, useEffect, useRef, useState } from 'react';
import { captureException, trackEvent } from '../lib/analytics';
import { readableErrorMessage } from '../lib/ipcError';
import type {
  CaptureWindowParams,
  ExportResult,
  ExportRuntimeStats,
  ExportSettings,
} from '../types';
import { useStore } from '../store';
import { prepareExportCapture } from '../lib/export/captureParams';

/**
 * With the chunked-export flag on, exports render through the chunk cache:
 * only chunks that changed since the last export (or background prerender)
 * are rendered, then joined. Any failure in that path falls back to a plain
 * single-pass export. Unknown flags read as off.
 */
async function isChunkedExportOn(): Promise<boolean> {
  try {
    return (await window.screenforge.getFeatureFlags()).chunkedExport === true;
  } catch {
    return false;
  }
}

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
    if (!useStore.getState().recordingResult) {
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
      const prepared = await prepareExportCapture(settings, assertNotCancelled);
      assertNotCancelled();
      const { effectiveFps, duration, warnings } = prepared;

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

      // Renders (or reuses) the video, writes audio, and muxes the output.
      const renderAndMux = async (
        chunking: CaptureWindowParams['chunking'],
      ): Promise<ExportResult> => {
        const workspace = await window.screenforge.createExportWorkspace(jobId);
        workspaceId = workspace.workspaceId;
        assertNotCancelled();

        const captureParams: CaptureWindowParams = {
          ...prepared.params,
          workspaceId: workspaceId as string,
          jobId,
          chunking,
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

        // startExport calls finalizeMuxer (or joins the cached chunks) on the main process side
        const exportResult = await window.screenforge.startExport({
          jobId,
          workspaceId,
          effectiveFps,
          outputPath,
          settings,
          ...(captureResult.chunkKeys ? { chunkKeys: captureResult.chunkKeys } : {}),
        });
        assertNotCancelled();
        if (captureResult.chunkStats) {
          trackEvent('export_chunks', {
            total: captureResult.chunkStats.total,
            rendered: captureResult.chunkStats.rendered,
          });
        }
        return exportResult;
      };

      const chunked = await isChunkedExportOn();
      let result: ExportResult;
      try {
        result = await renderAndMux(chunked ? 'export' : null);
      } catch (chunkedError) {
        const chunkedMessage = readableErrorMessage(chunkedError, 'Export failed');
        if (
          !chunked ||
          cancelledJobIdsRef.current.has(jobId) ||
          chunkedMessage.toLowerCase().includes('cancel') ||
          chunkedMessage.includes('closed unexpectedly')
        ) {
          throw chunkedError;
        }
        // The chunked path failed: export the plain way instead.
        captureException(chunkedError, {
          error_type: 'export_chunked_failed',
          message: chunkedMessage,
        });
        if (workspaceId) {
          await window.screenforge.cleanupExportWorkspace(workspaceId).catch(() => undefined);
          workspaceId = null;
        }
        setState((prev) => ({ ...prev, status: 'rendering', progress: 0 }));
        result = await renderAndMux(null);
      }

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
      // Without Electron's "Error invoking remote method ..." wrapper, so the
      // person sees the actual reason.
      const message = readableErrorMessage(error, 'Export failed');
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
        captureException(error, {
          error_type: 'export_failed',
          format: settings.format,
          resolution: settings.resolution,
          quality: settings.quality,
          has_audio: settings.includeAudio,
          message,
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
