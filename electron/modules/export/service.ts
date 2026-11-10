import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type {
  CaptureWindowParams,
  CaptureWindowResult,
  ExportFormat,
  ExportProgress,
  ExportRequest,
  ExportResult,
  ExportRuntimeStats,
  ExportSourceInfo,
  ExportWorkspace,
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

interface ActiveExport {
  jobId: string;
  workspaceId: string;
  phase: 'finalizing' | 'writing' | 'encoding';
  abortController: AbortController;
  cancelled: boolean;
  job?: FFmpegJob;
  cancel: () => Promise<void>;
}

interface WorkspaceState {
  workspaceId: string;
  jobId: string;
  rootPath: string;
  createdAt: number;
  audioPath?: string;
  activeMuxer?: ExportVideoMuxer;
}

let activeExport: ActiveExport | null = null;
const workspaces = new Map<string, WorkspaceState>();
const exportActivityListeners = new Set<() => void>();

// ── Hidden-window capture ──────────────────────────────────────────────────

/** Reference to the main window so we can forward capture progress to it. */
let mainWindowWebContents: Electron.WebContents | null = null;
/** Active hidden capture window (at most one at a time). */
let captureWindow: BrowserWindow | null = null;

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

export function isExportBusy(): boolean {
  return captureWindow !== null || activeExport !== null;
}

export function setMainWindowForCapture(wc: Electron.WebContents): void {
  mainWindowWebContents = wc;
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

/**
 * Create a hidden BrowserWindow that runs captureTimeline() in isolation so the
 * main window's JS event loop is never blocked during export compositing.
 */
export async function runCaptureInWindow(
  params: CaptureWindowParams,
  preloadPath: string,
): Promise<CaptureWindowResult> {
  await assertCaptureSourcesUsable(params);

  // Destroy any previous capture window (shouldn't happen, but be defensive)
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
  emitExportActivityChanged();

  return new Promise<CaptureWindowResult>((resolve, reject) => {
    // ── Forward progress from hidden window to main window ─────────────
    const onProgress = (_event: Electron.IpcMainEvent, value: number) => {
      if (_event.sender !== win.webContents) {
        return;
      }
      mainWindowWebContents?.send(CH.export.CAPTURE_PROGRESS, value);
    };

    // ── Send params once the hidden window signals it is ready ─────────
    // Using CAPTURE_READY (sent from ExportWorker's useEffect) rather than
    // did-finish-load avoids a race condition where params arrive before
    // the React useEffect listener is registered.
    const onReady = (_event: Electron.IpcMainEvent) => {
      if (_event.sender !== win.webContents) {
        return;
      }
      win.webContents.send(CH.export.CAPTURE_PARAMS, params);
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
      captureWindow = null;
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
    // Finalize the muxer to get the encoded video path.
    const t0 = performance.now();
    const tempVideoPath = await finalizeMuxer(request.workspaceId, active);
    log.info(`[export:service] finalizeMuxer durationMs=${Math.round(performance.now() - t0)}`);
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
  await fs.rm(workspace.rootPath, { recursive: true, force: true }).catch(() => undefined);
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
