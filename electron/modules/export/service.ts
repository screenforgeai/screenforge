import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, powerMonitor, shell } from 'electron';
import { powerAllowsPrerender, readBatteryLevel } from './power';
import { getFeatureFlags } from '../features/service';
import type {
  CaptureWindowParams,
  CaptureWindowResult,
  EdgeSmoothing,
  ExportFormat,
  ExportProgress,
  ExportRequest,
  ExportResult,
  ExportRuntimeStats,
  ExportSourceInfo,
  ExportWorkspace,
  ExportChunkSpec,
  ExportRunSpec,
  SerializedChunk,
  SerializedDecoderConfig,
} from '../../../src/types/index';
import { CH } from '../../channels';
import { startExportJob, startGifExportJob } from '../ffmpeg/jobs/export';
import type { FFmpegJob } from '../ffmpeg/runner';
import { getFFmpegPath } from '../ffmpeg/index';
import log from '../../lib/logger';
import { trackMemorySnapshot } from '../../lib/telemetry';
import { createExportVideoMuxer, type ExportVideoMuxer } from './videoMuxer';
import {
  ChunkCache,
  ChunkCacheError,
  ChunkRunWriter,
  assertChunkKey,
  buildConcatArgs,
  buildConcatList,
  checkFrameTimes,
  parseFrameTimes,
  chunkContainerFor,
  chunkNamespaceFor,
  streamSignatureFor,
  type ChunkContainer,
} from './chunkCache';
import { ChunkRuns } from './chunkRuns';
import { runFFmpeg } from '../ffmpeg/runner';

interface ActiveExport {
  jobId: string;
  workspaceId: string;
  phase: 'finalizing' | 'writing' | 'encoding';
  abortController: AbortController;
  cancelled: boolean;
  job?: FFmpegJob;
  cancel: () => Promise<void>;
}

interface WorkspaceChunking {
  namespace: string;
  container: ChunkContainer;
  fps: number;
  scratchDir: string | null;
  runs: ChunkRuns<{ writer: ChunkRunWriter; signature: string }>;
  /** Keys this capture uses; never evicted while it runs. */
  usedKeys: Set<string>;
}

interface WorkspaceState {
  workspaceId: string;
  jobId: string;
  rootPath: string;
  createdAt: number;
  audioPath?: string;
  activeMuxer?: ExportVideoMuxer;
  chunking?: WorkspaceChunking;
}

let activeExport: ActiveExport | null = null;
const workspaces = new Map<string, WorkspaceState>();
const exportActivityListeners = new Set<() => void>();

// ── Hidden-window capture ──────────────────────────────────────────────────

/** Reference to the main window so we can forward capture progress to it. */
let mainWindowWebContents: Electron.WebContents | null = null;
/** Active hidden capture window (at most one at a time). */
let captureWindow: BrowserWindow | null = null;
/** Background pre-renders share the capture window but never block anything. */
let captureWindowKind: 'export' | 'prerender' | null = null;
/**
 * The pace (duty cycle) the editor last asked for. A pre-render's window gets
 * it with its params, so a change made while the window was loading still applies.
 */
let prerenderDutyCycle: number | undefined;

let chunkCache: ChunkCache | null = null;
function getChunkCache(): ChunkCache {
  // The export harness points tests at their own, initially empty cache.
  chunkCache ??= new ChunkCache(
    process.env.SCREENFORGE_EXPORT_CACHE_DIR || path.join(app.getPath('userData'), 'export-cache'),
  );
  return chunkCache;
}

function emitExportActivityChanged(): void {
  for (const listener of exportActivityListeners) {
    listener();
  }
}

export function onExportActivityChanged(listener: () => void): () => void {
  exportActivityListeners.add(listener);
  return () => {
    exportActivityListeners.delete(listener);
  };
}

/** True while a background prerender's hidden window is open. */
export function isPrerenderWindowOpen(): boolean {
  return captureWindow !== null && captureWindowKind === 'prerender';
}

export function isExportBusy(): boolean {
  return (captureWindow !== null && captureWindowKind === 'export') || activeExport !== null;
}

export function setMainWindowForCapture(wc: Electron.WebContents): void {
  mainWindowWebContents = wc;
}

/** The editor window, for the channel layer to deliver prerender updates to. */
export function getMainWindowForCapture(): Electron.WebContents | null {
  return mainWindowWebContents && !mainWindowWebContents.isDestroyed()
    ? mainWindowWebContents
    : null;
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const CAPTURE_WORKER_LOAD_RETRY_DELAY_MS = 250;
const CAPTURE_WORKER_LOAD_MAX_ATTEMPTS = 120;
const EXPORT_CANCELLED_MESSAGE = 'Export cancelled';
const WORKSPACE_STALE_TTL_MS = 30 * 60 * 1000;
const FILE_COPY_CHUNK_BYTES = 8 * 1024 * 1024;

function createExportCancelledError(): Error {
  return new Error(EXPORT_CANCELLED_MESSAGE);
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code
  );
}

function assertExportNotCancelled(active: ActiveExport): void {
  if (active.cancelled || active.abortController.signal.aborted) {
    throw createExportCancelledError();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDevServer(baseUrl: string): Promise<void> {
  const url = new URL(baseUrl);
  url.hash = '';

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= CAPTURE_WORKER_LOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
      });

      if (response.ok || response.status < 500) {
        return;
      }

      lastError = new Error(`Unexpected dev server status: ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(CAPTURE_WORKER_LOAD_RETRY_DELAY_MS);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for export worker dev server at ${baseUrl}`);
}

async function loadCaptureWorkerURL(win: BrowserWindow): Promise<void> {
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const workerUrl = `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#export-worker`;
    await waitForDevServer(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    await win.loadURL(workerUrl);
    return;
  }

  await win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
    hash: 'export-worker',
  });
}

async function sourceFileSize(filePath: string): Promise<number | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? stats.size : null;
  } catch {
    return null;
  }
}

/**
 * The capture window reads its videos over screenforge://, which answers 416
 * to any range request on an empty file. Catch a missing or empty source here,
 * where we can say what's wrong, instead of as a fetch error mid-render.
 */
async function assertCaptureSourcesUsable(params: CaptureWindowParams): Promise<void> {
  const screenSize = await sourceFileSize(params.recording.filePath);
  if (screenSize === null) {
    throw new Error("This recording's video file can't be found, so it can't be exported.");
  }
  if (screenSize === 0) {
    throw new Error("This recording is empty or damaged, so it can't be exported.");
  }

  const { cameraPath } = params.recording;
  if (cameraPath && params.storeSnapshot.camera.enabled && !(await sourceFileSize(cameraPath))) {
    throw new Error(
      "This recording's camera video is missing or damaged. Turn off the camera to export without it.",
    );
  }
}

/** How this export smooths edges (see CaptureWindowParams.edgeSmoothing). */
function currentEdgeSmoothing(): EdgeSmoothing {
  return getFeatureFlags().fastExportEdges ? 'shader' : 'msaa';
}

/** The machine an export runs on, so its speed can be compared across computers. */
function logCaptureSystem(kind: 'export' | 'prerender', params: CaptureWindowParams): void {
  try {
    const cpus = os.cpus();
    const gpu = app.getGPUFeatureStatus();
    log.info('[export] system', {
      kind,
      chunking: params.chunking ?? null,
      edgeSmoothing: params.edgeSmoothing ?? currentEdgeSmoothing(),
      size: `${params.targetWidth}x${params.targetHeight}@${params.fps}`,
      format: params.format,
      platform: `${process.platform}-${process.arch} ${os.release()}`,
      cpu: `${cpus[0]?.model ?? 'unknown'} x${cpus.length}`,
      memoryGb: Math.round(os.totalmem() / 1e9),
      onBattery: powerMonitor.isOnBatteryPower(),
      gpuVideoEncode: gpu.video_encode,
      gpuVideoDecode: gpu.video_decode,
      gpuWebgl2: gpu.webgl2,
    });
  } catch (error) {
    log.info(`[export] system info unavailable: ${String(error)}`);
  }
}

/**
 * Create a hidden BrowserWindow that runs captureTimeline() in isolation so the
 * main window's JS event loop is never blocked during export compositing.
 */
export async function runCaptureInWindow(
  params: CaptureWindowParams,
  preloadPath: string,
  kind: 'export' | 'prerender' = 'export',
  /** Prerender only: true once the prerender this window is for was stopped. */
  isStopped: () => boolean = () => false,
): Promise<CaptureWindowResult> {
  await assertCaptureSourcesUsable(params);
  await prepareChunking(params);
  logCaptureSystem(kind, params);
  // Checked after the awaits above: an export, a recording or a stop may have
  // arrived meanwhile, and a prerender must never replace an export's window.
  if (
    kind === 'prerender' &&
    (isStopped() ||
      activeExport !== null ||
      (captureWindow !== null && captureWindowKind === 'export') ||
      prerenderBlocked())
  ) {
    throw new Error('Prerender stopped before it started');
  }

  // A real export replaces a background pre-render (its partial chunks are
  // discarded); otherwise this is only defensive.
  captureWindow?.destroy();

  const win = new BrowserWindow({
    show: false,
    width: 1,
    height: 1,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: false,
      offscreen: false,
      backgroundThrottling: false,
    },
  });
  captureWindow = win;
  captureWindowKind = kind;
  emitExportActivityChanged();
  if (kind === 'prerender') {
    // The background pre-render gives way to everything else on the machine.
    win.webContents.once('did-finish-load', () => {
      try {
        os.setPriority(
          win.webContents.getOSProcessId(),
          os.constants.priority.PRIORITY_BELOW_NORMAL,
        );
      } catch (error) {
        log.info(`[export:prerender] could not lower priority: ${String(error)}`);
      }
    });
  }

  return new Promise<CaptureWindowResult>((resolve, reject) => {
    // ── Forward progress from hidden window to main window ─────────────
    const onProgress = (_event: Electron.IpcMainEvent, value: number) => {
      if (_event.sender !== win.webContents) {
        return;
      }
      if (kind === 'export') {
        mainWindowWebContents?.send(CH.export.CAPTURE_PROGRESS, value);
      }
    };

    // ── Send params once the hidden window signals it is ready ─────────
    // Using CAPTURE_READY (sent from ExportWorker's useEffect) rather than
    // did-finish-load avoids a race condition where params arrive before
    // the React useEffect listener is registered.
    const onReady = (_event: Electron.IpcMainEvent) => {
      if (_event.sender !== win.webContents) {
        return;
      }
      // The worker only listens for an abort once it has its params, so a
      // stop sent while it was loading never reached it.
      if (kind === 'prerender' && isStopped()) {
        reject(new Error('Prerender stopped before it started'));
        cleanup();
        return;
      }
      win.webContents.send(CH.export.CAPTURE_PARAMS, {
        ...params,
        edgeSmoothing: params.edgeSmoothing ?? currentEdgeSmoothing(),
        ...(kind === 'prerender' ? { dutyCycle: prerenderDutyCycle ?? params.dutyCycle } : {}),
      });
    };

    // ── Resolve/reject handlers (one-shot) ─────────────────────────────
    // IMPORTANT: settle the Promise BEFORE calling cleanup(). cleanup() calls
    // win.destroy(), which emits 'closed' synchronously. The 'closed' handler
    // calls reject() — if the Promise isn't already settled, that reject wins.
    const onDone = (_event: Electron.IpcMainEvent, result: CaptureWindowResult) => {
      if (_event.sender !== win.webContents) {
        return;
      }
      resolve(result);
      cleanup();
    };

    const onError = (_event: Electron.IpcMainEvent, message: string) => {
      if (_event.sender !== win.webContents) {
        return;
      }
      reject(new Error(message));
      cleanup();
    };

    const cleanup = () => {
      ipcMain.off(CH.export.CAPTURE_PROGRESS, onProgress);
      ipcMain.off(CH.export.CAPTURE_DONE, onDone);
      ipcMain.off(CH.export.CAPTURE_ERROR, onError);
      ipcMain.off(CH.export.CAPTURE_READY, onReady);
      if (!win.isDestroyed()) {
        win.destroy();
      }
      if (captureWindow === win) {
        captureWindow = null;
        captureWindowKind = null;
      }
      emitExportActivityChanged();
    };

    ipcMain.on(CH.export.CAPTURE_PROGRESS, onProgress);
    ipcMain.on(CH.export.CAPTURE_DONE, onDone);
    ipcMain.on(CH.export.CAPTURE_ERROR, onError);
    ipcMain.once(CH.export.CAPTURE_READY, onReady);

    win.on('closed', () => {
      // If the window is closed externally before done/error fires, reject.
      cleanup();
      reject(new Error('Export capture window was closed unexpectedly'));
    });

    void loadCaptureWorkerURL(win).catch((error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
      cleanup();
    });
  });
}

/**
 * Abort the in-flight hidden window capture (called when the user cancels
 * during the 'rendering' phase).
 */
export function abortCaptureWindow(): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.webContents.send(CH.export.CAPTURE_ABORT);
  }
}

function resolveExtension(format: ExportFormat): string {
  if (format === 'webm') {
    return 'webm';
  }
  if (format === 'mov') {
    return 'mov';
  }
  if (format === 'gif') {
    return 'gif';
  }
  return 'mp4';
}

async function resolvePreferredDirectory(preferredDir?: string): Promise<string> {
  if (preferredDir?.trim()) {
    try {
      const st = await fs.stat(preferredDir);
      if (st.isDirectory()) {
        return preferredDir;
      }
    } catch {
      // Fall back to default Videos directory.
    }
  }
  return app.getPath('videos');
}

async function buildSuggestedExportPath(
  defaultName: string,
  format: ExportFormat,
  preferredDir?: string,
): Promise<string> {
  const ext = resolveExtension(format);
  const fallbackName = defaultName.trim() || `screenforge-export-${Date.now()}`;
  const fileName = fallbackName.endsWith(`.${ext}`) ? fallbackName : `${fallbackName}.${ext}`;
  const dir = await resolvePreferredDirectory(preferredDir);
  return path.join(dir, fileName);
}

export async function pickExportPath(
  defaultName: string,
  format: ExportFormat,
  preferredDir?: string,
): Promise<string | null> {
  const ext = resolveExtension(format);
  const suggestedPath = await buildSuggestedExportPath(defaultName, format, preferredDir);

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: suggestedPath,
    title: 'Export Video',
    filters: [
      {
        name: ext.toUpperCase(),
        extensions: [ext],
      },
    ],
  });

  if (canceled || !filePath) {
    return null;
  }

  return filePath;
}

export async function suggestExportPath(
  defaultName: string,
  format: ExportFormat,
  preferredDir?: string,
): Promise<string> {
  return buildSuggestedExportPath(defaultName, format, preferredDir);
}

export async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyFileCancellable(
  sourcePath: string,
  outputPath: string,
  active: ActiveExport,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const source = await fs.open(sourcePath, 'r');
  const output = await fs.open(outputPath, 'w');
  let shouldRemovePartial = true;

  try {
    const { size } = await source.stat();
    const buffer = Buffer.allocUnsafe(FILE_COPY_CHUNK_BYTES);
    let copiedBytes = 0;

    for (;;) {
      assertExportNotCancelled(active);
      const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }

      assertExportNotCancelled(active);
      await output.write(buffer, 0, bytesRead);
      copiedBytes += bytesRead;

      if (size > 0) {
        onProgress?.(Math.min(1, copiedBytes / size));
      }
    }

    shouldRemovePartial = false;
  } finally {
    await Promise.all([
      source.close().catch(() => undefined),
      output.close().catch(() => undefined),
    ]);

    if (shouldRemovePartial) {
      await fs.rm(outputPath, { force: true }).catch(() => undefined);
    }
  }
}

async function moveExportVideoToOutput(
  sourcePath: string,
  outputPath: string,
  active: ActiveExport,
  onProgress?: (percent: number) => void,
): Promise<void> {
  assertExportNotCancelled(active);

  try {
    await fs.rename(sourcePath, outputPath);
    onProgress?.(1);
    return;
  } catch (error) {
    if (!isNodeErrorWithCode(error, 'EXDEV')) {
      throw error;
    }
  }

  await copyFileCancellable(sourcePath, outputPath, active, onProgress);
  assertExportNotCancelled(active);
  await fs.rm(sourcePath, { force: true }).catch(() => undefined);
}

export async function revealExportInFolder(filePath: string): Promise<void> {
  shell.showItemInFolder(path.normalize(filePath));
}

export async function startExport(
  request: ExportRequest,
  onProgress?: (progress: ExportProgress) => void,
): Promise<ExportResult> {
  if (activeExport) {
    throw new Error('Another export is already running');
  }

  const workspace = workspaces.get(request.workspaceId);
  if (!workspace) {
    throw new Error('Export workspace missing or expired');
  }

  const jobId = request.jobId;
  const abortController = new AbortController();
  const active: ActiveExport = {
    jobId,
    workspaceId: request.workspaceId,
    phase: 'finalizing',
    abortController,
    cancelled: false,
    async cancel() {
      active.cancelled = true;
      active.abortController.abort();
      active.job?.cancel();
      await workspaces
        .get(active.workspaceId)
        ?.activeMuxer?.cancel()
        .catch(() => undefined);
    },
  };

  activeExport = active;
  emitExportActivityChanged();
  onProgress?.({ jobId, phase: 'encoding', time: 0, percent: 0.02 });

  const exportPhaseStart = performance.now();
  log.info(
    `[export:service] startExport jobId=${jobId} format=${request.settings.format} resolution=${request.settings.resolution} quality=${request.settings.quality}`,
  );

  try {
    // Finalize the muxer (or join the cached chunks) to get the encoded video path.
    const t0 = performance.now();
    const tempVideoPath = request.chunkKeys
      ? await joinChunksForExport(workspace, request.chunkKeys, active)
      : await finalizeMuxer(request.workspaceId, active);
    log.info(
      `[export:service] ${request.chunkKeys ? `joinChunks chunks=${request.chunkKeys.length}` : 'finalizeMuxer'} durationMs=${Math.round(performance.now() - t0)}`,
    );
    assertExportNotCancelled(active);
    onProgress?.({ jobId, phase: 'encoding', time: 0, percent: 0.16 });

    const hasAudioToMux = request.settings.includeAudio && Boolean(workspace.audioPath);
    if (request.settings.format !== 'gif' && !hasAudioToMux) {
      active.phase = 'writing';
      const t1 = performance.now();
      await moveExportVideoToOutput(tempVideoPath, request.outputPath, active, (percent) => {
        onProgress?.({
          jobId,
          phase: 'encoding',
          time: 0,
          percent: 0.16 + Math.min(1, percent) * 0.82,
        });
      });
      log.info(
        `[export:service] fileCopy/move durationMs=${Math.round(performance.now() - t1)} totalExportMs=${Math.round(performance.now() - exportPhaseStart)}`,
      );
      assertExportNotCancelled(active);
      onProgress?.({ jobId, phase: 'encoding', time: 0, percent: 0.98 });
      return { jobId, outputPath: request.outputPath };
    }

    const progressCallback = (p: { time: number; duration?: number; percent?: number }) =>
      onProgress?.({
        jobId,
        phase: 'encoding',
        time: p.time,
        duration: p.duration,
        percent: p.percent == null ? undefined : 0.16 + Math.min(1, p.percent) * 0.82,
      });

    let job: FFmpegJob;
    if (request.settings.format === 'gif') {
      // GIF: probe temp video for actual dimensions, then run palette-based FFmpeg conversion.
      // The WebCodecs capture phase always writes to a temp MP4 for GIF exports.
      const sourceInfo = await probeExportSource(tempVideoPath);
      const gifWidth = sourceInfo.width ?? 960;
      job = startGifExportJob({
        videoPath: tempVideoPath,
        outputPath: request.outputPath,
        fps: request.effectiveFps,
        width: gifWidth,
        onProgress: progressCallback,
      });
    } else {
      job = startExportJob({
        videoPath: tempVideoPath,
        audioPath: hasAudioToMux ? workspace.audioPath : undefined,
        outputPath: request.outputPath,
        settings: request.settings,
        onProgress: progressCallback,
      });
    }

    active.phase = 'encoding';
    active.job = job;

    const t2 = performance.now();
    log.info(
      `[export:service] ffmpeg job started format=${request.settings.format} hasAudio=${hasAudioToMux}`,
    );
    const outputPath = await job.promise;
    log.info(
      `[export:service] ffmpeg job done durationMs=${Math.round(performance.now() - t2)} totalExportMs=${Math.round(performance.now() - exportPhaseStart)}`,
    );
    assertExportNotCancelled(active);
    return { jobId, outputPath };
  } catch (error) {
    if (
      active.cancelled ||
      active.abortController.signal.aborted ||
      (error instanceof Error && error.message.toLowerCase().includes('cancel'))
    ) {
      throw createExportCancelledError();
    }
    throw error;
  } finally {
    await cleanupExportWorkspace(request.workspaceId);
    if (activeExport?.jobId === jobId) {
      activeExport = null;
    }
    emitExportActivityChanged();
    trackMemorySnapshot('after_export');
  }
}

export async function cancelExport(jobId: string): Promise<void> {
  // Abort any in-flight hidden-window capture (no-op if none is running)
  abortCaptureWindow();

  if (!activeExport || activeExport.jobId !== jobId) {
    return;
  }

  await activeExport.cancel();
}

async function sweepStaleWorkspaces(): Promise<void> {
  const cutoff = Date.now() - WORKSPACE_STALE_TTL_MS;
  for (const [id, workspace] of workspaces) {
    if (workspace.createdAt < cutoff) {
      workspaces.delete(id);
      await workspace.activeMuxer?.cancel().catch(() => undefined);
      await fs.rm(workspace.rootPath, { recursive: true, force: true }).catch(() => undefined);
      log.warn(`[export] swept stale workspace: ${id}`);
    }
  }
}

export async function createExportWorkspace(jobId: string): Promise<ExportWorkspace> {
  await sweepStaleWorkspaces();

  const workspaceId = `export-ws-${randomUUID()}`;
  const rootPath = path.join(app.getPath('temp'), workspaceId);

  await fs.mkdir(rootPath, { recursive: true });

  workspaces.set(workspaceId, { workspaceId, jobId, rootPath, createdAt: Date.now() });

  return { workspaceId };
}

export function initMuxer(
  workspaceId: string,
  format: ExportFormat,
  decoderConfig: SerializedDecoderConfig | null,
  width: number,
  height: number,
  fps: number,
): Promise<void> {
  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    throw new Error('Export workspace not found');
  }
  if (workspace.activeMuxer) {
    throw new Error('Muxer already initialized for this workspace');
  }

  // GIF uses a temp MP4 internally (WebCodecs capture → Mediabunny → FFmpeg palette conversion).
  const videoExt = format === 'webm' ? 'webm' : 'mp4';
  const videoPath = path.join(workspace.rootPath, `video.${videoExt}`);

  return createExportVideoMuxer({
    format: format === 'gif' ? 'mp4' : format,
    videoPath,
    decoderConfig,
    fps,
  }).then((muxer) => {
    workspace.activeMuxer = muxer;
    workspaces.set(workspaceId, workspace);
    log.info(
      `[export] muxer initialized for workspace ${workspaceId} (${format}, ${width}×${height} @ ${fps}fps)`,
    );
  });
}

export async function writeEncodedChunks(
  workspaceId: string,
  chunks: SerializedChunk[],
): Promise<void> {
  const workspace = workspaces.get(workspaceId);
  if (!workspace?.activeMuxer) {
    throw new Error('No active muxer for workspace ' + workspaceId);
  }

  await workspace.activeMuxer.writeEncodedChunks(chunks);
}

export async function finalizeMuxer(workspaceId: string, active?: ActiveExport): Promise<string> {
  if (active) {
    assertExportNotCancelled(active);
  }

  const workspace = workspaces.get(workspaceId);
  if (!workspace?.activeMuxer) {
    throw new Error('No active muxer for workspace ' + workspaceId);
  }

  let videoPath: string;
  try {
    videoPath = await workspace.activeMuxer.finalize();
  } catch (error) {
    if (active?.cancelled || active?.abortController.signal.aborted) {
      throw createExportCancelledError();
    }
    throw error;
  }

  if (active) {
    assertExportNotCancelled(active);
  }

  workspace.activeMuxer = undefined;
  workspaces.set(workspaceId, workspace);
  log.info('[export] muxer finalized');
  return videoPath;
}

export async function writeExportAudio(workspaceId: string, buffer: ArrayBuffer): Promise<string> {
  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    throw new Error('Export workspace not found');
  }

  const t = performance.now();
  const outPath = path.join(workspace.rootPath, 'audio.wav');
  await fs.writeFile(outPath, Buffer.from(buffer));
  log.info(
    `[export:service] writeExportAudio bytes=${buffer.byteLength} durationMs=${Math.round(performance.now() - t)}`,
  );
  workspace.audioPath = outPath;
  workspaces.set(workspaceId, workspace);
  return outPath;
}

export async function cleanupExportWorkspace(workspaceId: string): Promise<void> {
  const workspace = workspaces.get(workspaceId);
  if (!workspace) {
    return;
  }

  workspaces.delete(workspaceId);
  await workspace.activeMuxer?.cancel().catch(() => undefined);
  if (workspace.chunking) {
    for (const { writer } of await workspace.chunking.runs.settled()) {
      await writer.cancel();
    }
    if (workspace.chunking.scratchDir) {
      await fs
        .rm(workspace.chunking.scratchDir, { recursive: true, force: true })
        .catch(() => undefined);
    }
  }
  await fs.rm(workspace.rootPath, { recursive: true, force: true }).catch(() => undefined);
}

// ── Chunked export ─────────────────────────────────────────────────────────

async function fileIdentity(
  filePath: string | null | undefined,
): Promise<{ size: number | null; mtimeMs: number | null }> {
  if (!filePath) {
    return { size: null, mtimeMs: null };
  }
  try {
    const stat = await fs.stat(filePath);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return { size: null, mtimeMs: null };
  }
}

async function prepareChunking(params: CaptureWindowParams): Promise<void> {
  const workspace = workspaces.get(params.workspaceId);
  if (!workspace || !params.chunking) {
    return;
  }
  const recording = await fileIdentity(params.recording.filePath);
  const camera = await fileIdentity(params.recording.cameraPath);
  workspace.chunking = {
    namespace: chunkNamespaceFor({
      recordingPath: params.recording.filePath,
      recordingSize: recording.size,
      recordingMtimeMs: recording.mtimeMs,
      cameraPath: params.recording.cameraPath ?? null,
      cameraSize: camera.size,
      cameraMtimeMs: camera.mtimeMs,
      appVersion: app.getVersion(),
    }),
    container: chunkContainerFor(params.format),
    fps: params.fps,
    scratchDir: null,
    runs: new ChunkRuns(),
    usedKeys: new Set(),
  };
}

function getChunking(workspaceId: string): WorkspaceChunking {
  const chunking = workspaces.get(workspaceId)?.chunking;
  if (!chunking) {
    throw new Error('Export workspace is not set up for chunked export');
  }
  return chunking;
}

/** Which of these chunks are already cached. */
export async function lookupExportChunks(
  workspaceId: string,
  chunks: ExportChunkSpec[],
): Promise<boolean[]> {
  const chunking = getChunking(workspaceId);
  for (const chunk of chunks) {
    assertChunkKey(chunk.key);
    chunking.usedKeys.add(chunk.key);
  }
  return getChunkCache().lookup(chunking.namespace, chunks, chunking.container, chunking.fps);
}

export async function startChunkRun(
  workspaceId: string,
  runIndex: number,
  run: ExportRunSpec,
  decoderConfig: SerializedDecoderConfig | null,
): Promise<void> {
  const chunking = getChunking(workspaceId);
  for (const chunk of run.chunks) {
    assertChunkKey(chunk.key);
  }
  // Registered before the scratch folder exists: the run's first frames can
  // arrive while it is being made.
  await chunking.runs.start(runIndex, async () => {
    chunking.scratchDir ??= await getChunkCache().createScratchDir(chunking.namespace);
    const signature = streamSignatureFor(decoderConfig, chunking.fps);
    const cache = getChunkCache();
    return {
      writer: new ChunkRunWriter({
        dir: chunking.scratchDir,
        container: chunking.container,
        fps: chunking.fps,
        decoderConfig,
        run,
        onChunkComplete: (chunk) =>
          cache.put(chunking.namespace, chunk, chunking.container, chunking.fps, signature),
      }),
      signature,
    };
  });
}

export async function writeChunkRun(
  workspaceId: string,
  runIndex: number,
  chunks: SerializedChunk[],
): Promise<void> {
  const run = await getChunking(workspaceId).runs.get(runIndex);
  await run.writer.write(chunks);
}

/** Verifies a finished run's chunks and moves them into the cache. */
export async function endChunkRun(workspaceId: string, runIndex: number): Promise<void> {
  const chunking = getChunking(workspaceId);
  const run = await chunking.runs.take(runIndex);
  await run.writer.finish();
  await getChunkCache()
    .evict(chunking.usedKeys)
    .catch((error) => {
      log.warn(`[export:chunks] eviction failed: ${String(error)}`);
    });
}

/** Every video frame's time, read without decoding. */
async function readFrameTimes(filePath: string): Promise<number[]> {
  const bin = await getFFmpegPath();
  return new Promise((resolve) => {
    const args = [
      '-v',
      'error',
      '-i',
      filePath,
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-f',
      'framemd5',
      '-',
    ];
    const proc = spawn(bin, args);
    let stdout = '';
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    proc.on('error', () => resolve([]));
    proc.on('close', () => resolve(parseFrameTimes(stdout)));
  });
}

async function joinChunksForExport(
  workspace: WorkspaceState,
  keys: string[],
  active: ActiveExport,
): Promise<string> {
  const chunking = workspace.chunking;
  if (!chunking) {
    throw new ChunkCacheError('Export workspace is not set up for chunked export');
  }
  const { files, frames, chunkFrames, fps } = await getChunkCache().resolveForJoin(
    chunking.namespace,
    keys,
    chunking.container,
  );
  const listPath = path.join(workspace.rootPath, 'chunks.txt');
  await fs.writeFile(
    listPath,
    buildConcatList(files.map((file, i) => ({ file, durationSeconds: chunkFrames[i] / fps }))),
  );
  const outputPath = path.join(workspace.rootPath, `video.${chunking.container}`);
  const job = runFFmpeg(buildConcatArgs(listPath, outputPath), outputPath);
  active.job = job;
  await job.promise;
  active.job = undefined;
  assertExportNotCancelled(active);
  const problem = checkFrameTimes(await readFrameTimes(outputPath), frames, fps);
  if (problem) {
    throw new ChunkCacheError(`Joined video ${problem}`);
  }
  return outputPath;
}

// ── Background pre-render ──────────────────────────────────────────────────

/**
 * Renders the chunks missing for these params into the cache, without audio
 * or an output file. Returns false when it did not run to completion
 * (an export is running, it was stopped, or it failed).
 */
// ── Power ──────────────────────────────────────────────────────────────────

const BATTERY_LEVEL_TTL_MS = 60_000;
let cachedBatteryLevel: { level: number | null; readAt: number } | null = null;

/** Mains power, or a battery with at least 30% left (unknown level counts). */
export async function powerAllowsExportPrerender(): Promise<boolean> {
  const onBattery = powerMonitor.isOnBatteryPower();
  if (!onBattery) {
    return true;
  }
  if (!cachedBatteryLevel || Date.now() - cachedBatteryLevel.readAt > BATTERY_LEVEL_TTL_MS) {
    cachedBatteryLevel = { level: await readBatteryLevel(), readAt: Date.now() };
  }
  return powerAllowsPrerender({ onBattery, level: cachedBatteryLevel.level });
}

let powerWatchStarted = false;

/**
 * Tells the editor when the power starts or stops allowing pre-renders
 * (plugged in or out, battery crossing 30%), and stops a running pre-render
 * when it no longer does.
 */
export function watchPrerenderPower(onChange: (allowed: boolean) => void): void {
  if (powerWatchStarted) {
    return;
  }
  powerWatchStarted = true;
  let lastAllowed: boolean | null = null;
  const check = async () => {
    // Switched off mid-session: stop reading the battery.
    if (!getFeatureFlags().chunkedExport) {
      return;
    }
    const allowed = await powerAllowsExportPrerender().catch(() => true);
    if (!allowed) {
      stopExportPrerender();
    }
    if (allowed !== lastAllowed) {
      lastAllowed = allowed;
      onChange(allowed);
    }
  };
  const onPlugChange = () => {
    cachedBatteryLevel = null;
    void check();
  };
  powerMonitor.on('on-ac', onPlugChange);
  powerMonitor.on('on-battery', onPlugChange);
  // The level only matters on battery, and only reads the OS once a minute.
  setInterval(() => {
    if (getFeatureFlags().chunkedExport && powerMonitor.isOnBatteryPower()) {
      void check();
    }
  }, BATTERY_LEVEL_TTL_MS).unref?.();
}

let prerenderBlocked: () => boolean = () => false;

/** Something else (a recording) that a pre-render must never compete with. */
export function setPrerenderBlocker(isBlocked: () => boolean): void {
  prerenderBlocked = isBlocked;
}

// Bumped by every stop, so a prerender still starting up sees it was stopped.
let prerenderGeneration = 0;

export async function runExportPrerender(
  params: CaptureWindowParams,
  preloadPath: string,
): Promise<boolean> {
  const generation = prerenderGeneration;
  const isStopped = () => generation !== prerenderGeneration;
  prerenderDutyCycle = params.dutyCycle;
  const refuse = (reason: string) => {
    log.info(`[export:prerender] not started: ${reason}`);
    return false;
  };
  if (activeExport || (captureWindow && captureWindowKind === 'export')) {
    return refuse('an export is running');
  }
  if (prerenderBlocked()) {
    return refuse('a recording is running');
  }
  if (!getFeatureFlags().chunkedExport) {
    return refuse('the chunked-export flag is off');
  }
  if (!(await powerAllowsExportPrerender())) {
    return refuse('on battery below 30%');
  }
  if (isStopped()) {
    return refuse('stopped while starting');
  }
  const workspace = await createExportWorkspace(`prerender-${Date.now()}`);
  try {
    await runCaptureInWindow(
      { ...params, workspaceId: workspace.workspaceId, chunking: 'prerender', includeAudio: false },
      preloadPath,
      'prerender',
      isStopped,
    );
    return true;
  } catch (error) {
    log.info(
      `[export:prerender] stopped: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  } finally {
    await cleanupExportWorkspace(workspace.workspaceId);
  }
}

/**
 * Sets the background pre-render's pace: full speed while the editor's preview
 * sleeps, throttled while it draws. Kept for a pre-render that is still starting.
 */
export function setExportPrerenderPace(dutyCycle: number): void {
  if (!Number.isFinite(dutyCycle)) {
    return;
  }
  prerenderDutyCycle = dutyCycle;
  if (captureWindowKind === 'prerender' && captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.webContents.send(CH.export.PRERENDER_PACE, dutyCycle);
  }
}

/** Stops a background pre-render; chunks it already finished stay cached. */
export function stopExportPrerender(): void {
  // Also stops one that is still starting and has no window yet.
  prerenderGeneration += 1;
  if (captureWindowKind === 'prerender') {
    abortCaptureWindow();
  }
}

function parseProbe(stderr: string): ExportSourceInfo {
  let fps: number | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let duration: number | null = null;

  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (durationMatch) {
    duration =
      Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  }

  const videoLine = stderr
    .split(/\r?\n/)
    .find((line) => line.includes('Video:') && line.includes('Stream #'));

  if (videoLine) {
    const resMatch = videoLine.match(/(\d{2,5})x(\d{2,5})/);
    if (resMatch) {
      width = Number(resMatch[1]);
      height = Number(resMatch[2]);
    }

    const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*fps/);
    if (fpsMatch) {
      fps = Number(fpsMatch[1]);
    }
  }

  return { fps, width, height, duration };
}

export async function probeExportSource(filePath: string): Promise<ExportSourceInfo> {
  try {
    const bin = await getFFmpegPath();
    return await new Promise<ExportSourceInfo>((resolve) => {
      const proc = spawn(bin, ['-hide_banner', '-i', filePath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.once('error', (err) => {
        log.warn('[export] probe failed to spawn ffmpeg:', err);
        resolve({ fps: null, width: null, height: null, duration: null });
      });

      proc.once('close', () => {
        resolve(parseProbe(stderr));
      });
    });
  } catch (err) {
    log.warn('[export] probe failed:', err);
    return { fps: null, width: null, height: null, duration: null };
  }
}

function getAppUsageSnapshot(): { cpuPercent: number; memoryBytes: number } {
  let cpuPercent = 0;
  let memoryBytes = 0;
  for (const metric of app.getAppMetrics()) {
    const cpu = (metric as unknown as { cpu?: { percentCPUUsage?: number } }).cpu?.percentCPUUsage;
    const memory = (metric as unknown as { memory?: { workingSetSize?: number } }).memory
      ?.workingSetSize;
    if (typeof cpu === 'number' && Number.isFinite(cpu)) {
      cpuPercent += cpu;
    }
    if (typeof memory === 'number' && Number.isFinite(memory)) {
      memoryBytes += memory * 1024;
    }
  }
  return { cpuPercent, memoryBytes };
}

async function getMacProcessUsage(
  pid: number,
): Promise<{ cpuPercent: number; memoryBytes: number } | null> {
  if (!Number.isInteger(pid) || pid <= 0 || process.platform !== 'darwin') {
    return null;
  }

  return new Promise((resolve) => {
    const proc = spawn('ps', ['-p', String(pid), '-o', '%cpu=,rss='], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let stdout = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.once('error', () => resolve(null));
    proc.once('close', (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      const parts = stdout
        .trim()
        .split(/\s+/)
        .map((value) => Number(value));

      if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
        resolve(null);
        return;
      }

      resolve({
        cpuPercent: parts[0],
        memoryBytes: parts[1] * 1024,
      });
    });
  });
}

export async function getExportStats(jobId?: string): Promise<ExportRuntimeStats> {
  const appUsage = getAppUsageSnapshot();
  const shouldIncludeEncoding = activeExport && (!jobId || activeExport.jobId === jobId);
  let cpuPercent = appUsage.cpuPercent;
  let memoryBytes = appUsage.memoryBytes;

  if (shouldIncludeEncoding) {
    const ffmpegPid = activeExport?.job?.getPid() ?? null;
    if (ffmpegPid) {
      const ffmpegUsage = await getMacProcessUsage(ffmpegPid);
      if (ffmpegUsage) {
        cpuPercent += ffmpegUsage.cpuPercent;
        memoryBytes += ffmpegUsage.memoryBytes;
      }
    }
  }

  return {
    jobId: shouldIncludeEncoding ? activeExport?.jobId : undefined,
    phase: shouldIncludeEncoding ? 'encoding' : 'capturing',
    cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : undefined,
    memoryBytes: Number.isFinite(memoryBytes) ? memoryBytes : undefined,
    sampledAt: Date.now(),
  };
}
