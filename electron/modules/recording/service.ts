import { app, screen } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type {
  CursorEvent,
  CursorType,
  RecordingArea,
  RecordingBoundsSample,
} from '../../../src/types/index';
import { buildMergeAudioArgs } from '../../../src/lib/recording/audioMerge';
import { summarizeCursorEvents } from '../../../src/lib/recording/cursorTiming';
import {
  computeActiveDurationMs,
  computeActiveStopTime,
  finalizePauseSpans,
  normalizeTimestampedEntries,
  type RecordingPauseSpan,
} from '../../../src/lib/recording/timing';
import { getFFmpegPath } from '../ffmpeg/index';
import { runFFmpeg } from '../ffmpeg/runner';
import log from '../../lib/logger';
import { trackMemorySnapshot } from '../../lib/telemetry';
import { shouldUseNativeCapture } from '../../lib/macos-native-capture';
import {
  getLinuxCaptureBackend,
  getLinuxSessionType,
  isWaylandSession,
  type CaptureBackend,
} from '../../lib/linux-capture';
import { prepareRecordingStartPermissionsIfNeeded } from '../app/service';
import { createNativeCursorPointNormalizer } from './utils/native-cursor-normalizer';
import { getMacWindowMetadata, parseWindowIdFromSourceId } from '../sources/service';
import { probeExportSource } from '../export/service';
import { computeFallbackCaptureBitrate, formatFFmpegBitrate } from './captureQuality';
import {
  buildH264EncodeArgs,
  buildSegmentConcatArgs,
  buildSegmentConcatList,
  buildWaylandTranscodeArgs,
  buildX11GrabArgs,
  clampCaptureBounds,
  fitH264FrameSize,
  type CaptureBounds,
  type CaptureSegment,
} from './capture-args';
import { getX11WindowGeometry } from './x11-window-geometry';
import {
  normalizeKeyboardModifiers,
  normalizeKeyLabel,
  normalizeKeyCategory,
  shouldPersistKeyLabel,
  toCategorizedKeyboardEvent,
} from './input-events';

// ── Screenforge window exclusion ──────────────────────────────────────────────

type Rectangle = { x: number; y: number; width: number; height: number };
type BoundsProvider = () => Rectangle[];

let excludedBoundsProvider: BoundsProvider | null = null;

export function setExcludedWindowBoundsProvider(provider: BoundsProvider): void {
  excludedBoundsProvider = provider;
}

function isPointInRect(px: number, py: number, rect: Rectangle): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

function isOnScreenforgeWindow(x: number, y: number): boolean {
  if (!excludedBoundsProvider) {
    return false;
  }
  return excludedBoundsProvider().some((rect) => isPointInRect(x, y, rect));
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Hard cap on stored cursor events. At 120 Hz uiohook throttle this allows
// ~40 minutes of recording before dropping events. Prevents runaway heap growth
// when two instances run simultaneously or during very long recordings.
const MAX_CURSOR_EVENTS = 300_000;

// ── State ─────────────────────────────────────────────────────────────────────

let cursorEvents: CursorEvent[] = [];
let recordingStartTime = 0;
let recordingArea: RecordingArea = { x: 0, y: 0, width: 0, height: 0 };

// Mousemove throttle — cap at 120 Hz and skip sub-pixel moves to reduce the
// number of event objects pushed into cursorEvents during recording.
const MOVE_MIN_INTERVAL_MS = 1000 / 120;
const MOVE_MIN_DISTANCE_SQ = 1; // 1 logical pixel squared
let lastMoveX = -1;
let lastMoveY = -1;
let lastMoveMs = 0;
let recordingBoundsTimeline: RecordingBoundsSample[] = [];
let recordingPaused = false;
let recordingPauseSpans: RecordingPauseSpan[] = [];

let ffmpegProc: ChildProcess | null = null;
let ffmpegOutputPath: string | null = null;
// FFmpeg capture pauses by finalizing the running file and starting a fresh
// one on resume; stop joins the segments. (SIGSTOP doesn't work: x11grab
// stamps frames with the wall clock, so the paused time stayed in the video
// while cursor events had it removed.) Set for the whole FFmpeg recording.
let ffmpegCaptureSpawn: { bin: string; buildArgs: (outPath: string) => string[] } | null = null;
let ffmpegSegments: CaptureSegment[] = [];
let ffmpegSegmentStartedAt = 0;
let ffmpegSegmentTransition: Promise<void> = Promise.resolve();

let captureProc: ChildProcess | null = null;
let captureOutputPath: string | null = null;
let nativeMediaStartTime: number | null = null;

// Wayland (Linux): the renderer captures the PipeWire portal stream with
// MediaRecorder and hands the finished webm back at stop time. The main
// process only tracks timing and transcodes the result.
let rendererCaptureActive = false;

let toolbarWindowTitleForCapture: string | undefined;
let activeWindowRecording = false;
const recordingActivityListeners = new Set<() => void>();

let appendMode = false;

// ── uiohook single-instance lock ──────────────────────────────────────────────
// Two app instances (e.g. dev + packaged) both calling uiohook.start() install
// competing CGEventTap / SetWindowsHookEx handlers at OS level, causing
// system-wide input stalls. A file lock prevents the second instance from
// starting uiohook and allows it to degrade gracefully.
const UIOHOOK_LOCK_PATH = path.join(os.tmpdir(), 'screenforge-uiohook.lock');
let uiohookLockFd: number | null = null;

function acquireUiohookLock(): boolean {
  try {
    // O_EXCL | O_CREAT: atomic create-or-fail. Another process holding the fd
    // keeps the file open; the fd is released when that process exits or calls
    // releaseUiohookLock().
    uiohookLockFd = fsSync.openSync(UIOHOOK_LOCK_PATH, 'wx');
    return true;
  } catch {
    // EEXIST — another instance holds the lock
    return false;
  }
}

function releaseUiohookLock(): void {
  if (uiohookLockFd !== null) {
    try {
      fsSync.closeSync(uiohookLockFd);
      fsSync.unlinkSync(UIOHOOK_LOCK_PATH);
    } catch {
      // Ignore — process may be exiting
    }
    uiohookLockFd = null;
  }
}

const CAPTURE_READY_TIMEOUT_MS = process.platform === 'darwin' ? 8000 : 4000;
// On Windows, the binary runs a Finalize() with an 8-second internal timeout and
// exits itself. These delays are backstops for older binaries or edge cases.
const STOP_SIGINT_DELAY_MS = process.platform === 'win32' ? 12000 : 2000;
// Every FFmpeg capture path grabs at 60fps (buildCaptureArgs).
const FFMPEG_CAPTURE_FRAME_MS = 1000 / 60;
const STOP_SIGTERM_DELAY_MS = process.platform === 'win32' ? 18000 : 8000;
const STOP_SIGKILL_DELAY_MS = process.platform === 'win32' ? 25000 : 12000;

type UiohookModule = typeof import('uiohook-napi');
type UiohookInstance = UiohookModule['uIOhook'];

let loadedUiohook: UiohookInstance | null = null;

function emitRecordingActivityChanged(): void {
  for (const listener of recordingActivityListeners) {
    listener();
  }
}

export function onRecordingActivityChanged(listener: () => void): () => void {
  recordingActivityListeners.add(listener);
  return () => {
    recordingActivityListeners.delete(listener);
  };
}

export function isRecordingBusy(): boolean {
  return (
    captureProc !== null ||
    ffmpegProc !== null ||
    ffmpegCaptureSpawn !== null ||
    rendererCaptureActive
  );
}

/**
 * Which capture backend startRecording() will use on this machine.
 * The renderer uses this to decide whether it must capture the screen itself
 * (Wayland portal via getDisplayMedia + MediaRecorder).
 */
export function getCaptureBackend(): CaptureBackend {
  if (shouldUseNativeCapture()) {
    return 'native';
  }
  if (process.platform === 'linux') {
    return getLinuxCaptureBackend();
  }
  // macOS < 13 AVFoundation / any other FFmpeg-based fallback
  return 'ffmpeg-x11';
}

function getPackagedUiohookDir(resourcesPath: string): string {
  return path.join(resourcesPath, `uiohook-napi-${process.platform}-${process.arch}`);
}

// ── macOS native helper gate ───────────────────────────────────────────────────

function getNativeHelperPath(): string {
  if (process.platform === 'win32') {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'ScreenforgeCapture.exe');
    }
    // Dev: run `pnpm build:native:windows` first to produce this binary.
    return path.join(app.getAppPath(), 'native', 'bin', 'win32-x64', 'ScreenforgeCapture.exe');
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ScreenforgeCapture');
  }
  // Dev: run `pnpm build:native:macos` first to produce this binary.
  return path.join(app.getAppPath(), 'native', 'bin', 'ScreenforgeCapture');
}

export function setToolbarWindowTitle(title: string): void {
  toolbarWindowTitleForCapture = title;
}

// ── Display resolution ────────────────────────────────────────────────────────

function resolveDisplayForSource(sourceId: string): Electron.Display {
  const displays = screen.getAllDisplays();

  if (sourceId.startsWith('screen:')) {
    const rawId = sourceId.split(':')[1] ?? '';
    const parsedId = Number(rawId);

    const byId = displays.find(
      (display) => String(display.id) === rawId || display.id === parsedId,
    );
    if (byId) {
      return byId;
    }

    const idx = Number.parseInt(rawId, 10);
    if (Number.isInteger(idx) && idx >= 0 && idx < displays.length) {
      return displays[idx];
    }

    log.warn('[recording] could not map sourceId to display, falling back to primary:', sourceId);
  }

  // Window sources — fall back to primary display for now
  return screen.getPrimaryDisplay();
}

function parseDisplayIdFromSource(sourceId: string): number | null {
  if (!sourceId.startsWith('screen:')) {
    return null;
  }
  const rawId = sourceId.split(':')[1] ?? '';
  const parsedId = Number.parseInt(rawId, 10);
  return Number.isInteger(parsedId) && parsedId >= 0 ? parsedId : null;
}

function isWindowSource(sourceId: string): boolean {
  return sourceId.startsWith('window:');
}

function ensureRecordingBoundsSample(sample: RecordingBoundsSample): void {
  const lastSample = recordingBoundsTimeline[recordingBoundsTimeline.length - 1];
  if (
    lastSample &&
    Math.abs(lastSample.x - sample.x) < 0.5 &&
    Math.abs(lastSample.y - sample.y) < 0.5 &&
    Math.abs(lastSample.width - sample.width) < 0.5 &&
    Math.abs(lastSample.height - sample.height) < 0.5 &&
    Math.abs((lastSample.scaleFactor ?? 1) - (sample.scaleFactor ?? 1)) < 0.01
  ) {
    return;
  }

  recordingBoundsTimeline.push(sample);
}

// ── FFmpeg capture args ───────────────────────────────────────────────────────

function buildCaptureArgs(
  display: Electron.Display,
  outPath: string,
  captureArea?: CaptureBounds,
): string[] {
  const { x, y, width, height } = display.bounds;

  if (process.platform === 'linux' && getLinuxSessionType() === 'x11' && process.env.DISPLAY) {
    return buildX11GrabArgs(captureArea ?? { x, y, width, height }, process.env.DISPLAY, outPath);
  }

  if (process.platform === 'darwin') {
    const input = resolveDarwinCaptureInput(display);
    const bitrate = computeFallbackCaptureBitrate(display, 60);

    return [
      '-f',
      'avfoundation',
      '-capture_cursor',
      '0',
      '-framerate',
      '60',
      '-i',
      input,
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      formatFFmpegBitrate(bitrate),
      '-maxrate',
      formatFFmpegBitrate(bitrate * 1.5),
      '-bufsize',
      formatFFmpegBitrate(bitrate * 3),
      '-q:v',
      '100',
      '-y',
      outPath,
    ];
  }

  if (process.platform === 'win32') {
    return [
      '-f',
      'gdigrab',
      '-draw_mouse',
      '0',
      '-framerate',
      '60',
      '-offset_x',
      String(x),
      '-offset_y',
      String(y),
      '-video_size',
      `${width}x${height}`,
      '-i',
      'desktop',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-tune',
      'zerolatency',
      '-crf',
      '14',
      '-y',
      outPath,
    ];
  }

  if (process.platform === 'linux') {
    throw new Error(
      'Could not detect a supported display session (X11 or Wayland). Screen capture is unavailable.',
    );
  }

  throw new Error(`Unsupported platform for FFmpeg screen capture: ${process.platform}`);
}

/**
 * Wayland: transcodes the renderer-captured portal webm (VP9/VP8 from
 * MediaRecorder) into the H.264 MP4 the rest of the pipeline expects.
 * MediaRecorder output has no audio (mic is a separate track merged later).
 */
async function finalizeRendererCapture(webmPath: string): Promise<string> {
  const outPath = createTempPath('screenforge-wayland', 'mp4');
  const args = buildWaylandTranscodeArgs(webmPath, outPath);

  log.info('[recording:wayland] transcoding renderer capture', { webmPath, outPath });
  await runFFmpeg(args, outPath).promise;
  await fs.unlink(webmPath).catch(() => undefined);
  return outPath;
}

function resolveDarwinCaptureInput(display: Electron.Display): string {
  const displays = screen.getAllDisplays();
  const displayIndex = displays.findIndex((candidate) => candidate.id === display.id);
  const screenIndex = displayIndex >= 0 ? displayIndex : 0;
  return `Capture screen ${screenIndex}:none`;
}

function createTempPath(prefix: string, extension: string): string {
  return path.join(app.getPath('temp'), `${prefix}-${randomUUID()}.${extension}`);
}

function trySignalProcess(
  proc: ChildProcess | null,
  signal: NodeJS.Signals,
  warning: string,
): boolean {
  const pid = proc?.pid;
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    log.warn(warning, err);
    return false;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function noteNativeMediaStarted(): void {
  if (nativeMediaStartTime !== null) {
    log.info('[recording:native] sink-writer-ready duplicate — already set', {
      existing: nativeMediaStartTime,
      recordingStartTime,
    });
    return;
  }

  nativeMediaStartTime = Date.now();
  log.info('[recording:native] media timeline started (sink writer ready)', {
    nativeMediaStartTime,
    recordingStartTime,
    deltaMs: recordingStartTime > 0 ? nativeMediaStartTime - recordingStartTime : null,
  });
}

function recordCursorEvent(event: Omit<CursorEvent, 'timestamp'>): void {
  if (recordingPaused) {
    return;
  }

  if (cursorEvents.length >= MAX_CURSOR_EVENTS) {
    return;
  }

  // Drop clicks and scrolls that land on Screenforge's own overlay windows.
  if (
    (event.type === 'mousedown' || event.type === 'mouseup' || event.type === 'scroll') &&
    typeof event.x === 'number' &&
    typeof event.y === 'number' &&
    isOnScreenforgeWindow(event.x, event.y)
  ) {
    return;
  }

  cursorEvents.push({ ...event, timestamp: Date.now() });
}

async function loadUiohook(): Promise<UiohookInstance> {
  if (loadedUiohook) {
    return loadedUiohook;
  }

  try {
    const module = await import('uiohook-napi');
    loadedUiohook = module.uIOhook;
    return loadedUiohook;
  } catch (directImportError) {
    if (app.isPackaged) {
      const packagedModulePath = path.join(
        getPackagedUiohookDir(process.resourcesPath),
        'dist',
        'index.js',
      );

      try {
        const module = (await import(pathToFileURL(packagedModulePath).href)) as UiohookModule;
        loadedUiohook = module.uIOhook;
        return loadedUiohook;
      } catch (packagedImportError) {
        throw new Error(
          `Global cursor tracking is unavailable because uiohook-napi could not be loaded from the packaged app: ${
            packagedImportError instanceof Error
              ? packagedImportError.message
              : String(packagedImportError)
          }`,
        );
      }
    }

    throw new Error(
      `Global cursor tracking is unavailable because uiohook-napi could not be loaded: ${
        directImportError instanceof Error ? directImportError.message : String(directImportError)
      }`,
    );
  }
}

async function startCursorTracking(): Promise<void> {
  // Prevent two app instances from both installing a global OS event tap.
  // The second instance skips uiohook and relies on native-capture cursor
  // events instead, which avoids competing CGEventTap / SetWindowsHookEx
  // handlers that cause system-wide input stalls.
  if (!acquireUiohookLock()) {
    log.warn(
      '[recording] uiohook-napi: another Screenforge instance already holds the global cursor hook; skipping uiohook for this recording',
    );
    return;
  }

  const uIOhook = await loadUiohook();
  // Remove any stale handlers before re-registering (guards against retry-without-stop paths).
  uIOhook.removeAllListeners();

  uIOhook.on('mousemove', (e) => {
    const now = Date.now();
    const dx = e.x - lastMoveX;
    const dy = e.y - lastMoveY;
    if (now - lastMoveMs < MOVE_MIN_INTERVAL_MS || dx * dx + dy * dy < MOVE_MIN_DISTANCE_SQ) {
      return;
    }
    lastMoveX = e.x;
    lastMoveY = e.y;
    lastMoveMs = now;
    recordCursorEvent({ type: 'move', x: e.x, y: e.y });
  });

  uIOhook.on('mousedown', (e) => {
    recordCursorEvent({ type: 'mousedown', x: e.x, y: e.y, button: e.button });
  });

  uIOhook.on('mouseup', (e) => {
    recordCursorEvent({ type: 'mouseup', x: e.x, y: e.y, button: e.button });
  });

  uIOhook.on('wheel', (e) => {
    recordCursorEvent({
      type: 'scroll',
      x: e.x,
      y: e.y,
      deltaX: 0,
      deltaY: e.rotation,
    });
  });

  uIOhook.on('keydown', (e) => {
    recordCursorEvent(toCategorizedKeyboardEvent('keydown', e));
  });

  uIOhook.on('keyup', (e) => {
    recordCursorEvent(toCategorizedKeyboardEvent('keyup', e));
  });

  uIOhook.start();
}

function stopCursorTracking(): void {
  releaseUiohookLock();

  if (!loadedUiohook) {
    return;
  }

  const uIOhook = loadedUiohook;
  uIOhook.stop();
  uIOhook.removeAllListeners();
}

// ── Native capture (macOS 13+) ────────────────────────────────────────────────

function resolveDisplayIndex(display: Electron.Display): number {
  const displays = screen.getAllDisplays();
  const idx = displays.findIndex((d) => d.id === display.id);
  return idx >= 0 ? idx : 0;
}

function resolveDisplayId(display: Electron.Display): number | null {
  const id = typeof display.id === 'number' ? display.id : Number.parseInt(String(display.id), 10);
  return Number.isInteger(id) && id >= 0 ? id : null;
}

/**
 * Maps a raw cursorType string emitted by the Swift helper to CursorType.
 * The helper already emits the canonical strings; this is a safety net for
 * any unknown values the helper might produce in future.
 */
function normalizeCursorType(raw: string | undefined): CursorType {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return 'default';
  }

  if (['default', 'arrow', 'arrowcursor'].includes(normalized)) {
    return 'default';
  }

  if (
    [
      'pointer',
      'pointinghand',
      'pointinghandcursor',
      'draglink',
      'draglinkcursor',
      'dragcopy',
      'dragcopycursor',
      'link',
      'hand',
    ].includes(normalized)
  ) {
    return 'pointer';
  }

  if (
    [
      'text',
      'ibeam',
      'ibeamcursor',
      'ibeamcursorforverticallayout',
      'xterm',
      'verticaltext',
    ].includes(normalized)
  ) {
    return 'text';
  }

  if (['crosshair', 'cross'].includes(normalized)) {
    return 'crosshair';
  }

  if (['grab', 'grabbing', 'openhand', 'closedhand'].includes(normalized)) {
    return 'grab';
  }

  if (
    [
      'resize',
      'col-resize',
      'row-resize',
      'ew-resize',
      'ns-resize',
      'nesw-resize',
      'nwse-resize',
      'resizeleftcursor',
      'resizerightcursor',
      'resizeupcursor',
      'resizedowncursor',
      'resizeleftrightcursor',
      'resizeupdowncursor',
    ].includes(normalized)
  ) {
    return 'resize';
  }

  return 'default';
}

async function startNativeCapture(
  display: Electron.Display,
  outPath: string,
  sourceDisplayId: number | null,
  sourceWindowId: number | null,
): Promise<void> {
  const helperPath = getNativeHelperPath();
  const displayIndex = resolveDisplayIndex(display);
  const displayId = sourceDisplayId ?? resolveDisplayId(display);

  const args: string[] = ['--output', outPath, '--fps', '60'];
  if (sourceWindowId !== null) {
    args.push('--window-id', String(sourceWindowId));
  } else {
    args.push('--display', String(displayIndex));
  }
  if (displayId !== null && sourceWindowId === null) {
    args.push('--display-id', String(displayId));
  }

  if (toolbarWindowTitleForCapture && sourceWindowId === null) {
    args.push('--exclude-window-title', toolbarWindowTitleForCapture);
  }

  log.info(
    '[recording:native] resolved display:',
    `id=${display.id}`,
    `sourceIdDisplay=${sourceDisplayId ?? 'n/a'}`,
    `index=${displayIndex}`,
    `bounds=${display.bounds.width}x${display.bounds.height}@${display.bounds.x},${display.bounds.y}`,
  );
  log.info('[recording:native] spawning helper:', path.basename(helperPath));

  captureProc = spawn(helperPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  captureOutputPath = outPath;
  emitRecordingActivityChanged();

  captureProc.on('error', (err) => log.error('[native:capture] spawn error:', err));

  const normalizePoint =
    sourceWindowId === null
      ? createNativeCursorPointNormalizer(display, (info) => {
          log.info(
            '[recording:native] cursor coordinate mode:',
            info.mode,
            `(scale=${info.scaleFactor}, logicalHits=${info.logicalHits}, scaledHits=${info.scaledHits}, samples=${info.samples})`,
          );
        })
      : null;

  // Parse newline-delimited JSON cursor events from stdout
  let stdoutBuf = '';
  captureProc.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const evt = JSON.parse(trimmed) as {
          type: CursorEvent['type'] | 'bounds';
          x?: number;
          y?: number;
          deltaX?: number;
          deltaY?: number;
          button?: string | number;
          cursorType?: string;
          keyCategory?: unknown;
          keyLabel?: unknown;
          modifiers?: {
            meta?: boolean;
            ctrl?: boolean;
            alt?: boolean;
            shift?: boolean;
          };
          repeat?: boolean;
          timestamp?: number;
          width?: number;
          height?: number;
          scaleFactor?: number;
        };

        if (
          evt.type === 'bounds' &&
          typeof evt.x === 'number' &&
          typeof evt.y === 'number' &&
          typeof evt.width === 'number' &&
          typeof evt.height === 'number'
        ) {
          ensureRecordingBoundsSample({
            timestamp: Date.now(),
            x: evt.x,
            y: evt.y,
            width: evt.width,
            height: evt.height,
            scaleFactor: typeof evt.scaleFactor === 'number' ? evt.scaleFactor : undefined,
          });
          continue;
        }
        if (evt.type === 'bounds') {
          continue;
        }

        if (!recordingPaused) {
          const timestamp = typeof evt.timestamp === 'number' ? evt.timestamp : Date.now();
          if (evt.type === 'keydown' || evt.type === 'keyup') {
            if (cursorEvents.length < MAX_CURSOR_EVENTS) {
              const keyCategory = normalizeKeyCategory(evt.keyCategory);
              const modifiers = normalizeKeyboardModifiers(evt.modifiers);
              const keyLabel = shouldPersistKeyLabel(keyCategory, modifiers)
                ? normalizeKeyLabel(evt.keyLabel)
                : undefined;
              cursorEvents.push({
                type: evt.type,
                timestamp,
                keyCategory,
                ...(keyLabel ? { keyLabel } : {}),
                modifiers,
                repeat: evt.repeat === true,
              });
            }
            continue;
          }

          const normalizedCursorType = normalizeCursorType(evt.cursorType);
          const normalizedPoint =
            evt.x !== undefined && evt.y !== undefined && normalizePoint
              ? normalizePoint(evt.x, evt.y)
              : null;
          const nx = normalizedPoint?.x ?? evt.x;
          const ny = normalizedPoint?.y ?? evt.y;

          // Drop clicks and scrolls on Screenforge's own overlay windows.
          if (
            (evt.type === 'mousedown' || evt.type === 'mouseup' || evt.type === 'scroll') &&
            typeof nx === 'number' &&
            typeof ny === 'number' &&
            isOnScreenforgeWindow(nx, ny)
          ) {
            continue;
          }

          if (cursorEvents.length < MAX_CURSOR_EVENTS) {
            cursorEvents.push({
              type: evt.type as CursorEvent['type'],
              x: nx,
              y: ny,
              deltaX: evt.deltaX,
              deltaY: evt.deltaY,
              button: evt.button,
              cursorType: normalizedCursorType,
              timestamp,
            });
          }
        }
      } catch {
        log.warn('[native:capture] failed to parse stdout line:', trimmed);
      }
    }
  });

  await waitForNativeHelperReady(captureProc);
}

function waitForNativeHelperReady(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderrBuf = '';
    let readyStderrBuf = '';
    let readyReceived = false;

    const logNativeCaptureLine = (line: string) => {
      log.info('[native:capture]', line);
      if (line.includes('sink writer ready')) {
        noteNativeMediaStarted();
      }
    };

    const finish = (timedOut = false) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(fallback);
      proc.stderr?.removeListener('data', onData);
      // Continue logging stderr after ready
      proc.stderr?.on('data', (chunk: Buffer) => {
        readyStderrBuf += chunk.toString();
        const lines = readyStderrBuf.split(/\r?\n/);
        readyStderrBuf = lines.pop() ?? '';
        for (const line of lines) {
          const normalized = line.trim();
          if (normalized) {
            logNativeCaptureLine(normalized);
          }
        }
      });
      if (timedOut) {
        log.warn('[native:capture] timed out waiting for ready signal — starting anyway');
      }
      resolve();
    };

    const fallback = setTimeout(() => finish(true), CAPTURE_READY_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split(/\r?\n/);
      stderrBuf = lines.pop() ?? '';

      for (const line of lines) {
        const normalized = line.trim();
        if (!normalized) {
          continue;
        }
        logNativeCaptureLine(normalized);
        if (normalized.includes('Recording started')) {
          readyReceived = true;
          log.info('[recording:native] "Recording started" received', {
            receivedAt: Date.now(),
            nativeMediaStartTimeAtReceive: nativeMediaStartTime,
          });
          finish();
          break;
        }
      }
    };

    proc.stderr?.on('data', onData);
    proc.once('close', (code) => {
      if (readyReceived) {
        finish();
        return;
      }
      // Process exited before signalling ready — treat as a hard failure so the
      // caller can surface a user-facing error instead of silently "starting" a
      // capture that produced nothing.
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(fallback);
      proc.stderr?.removeListener('data', onData);
      log.error('[native:capture] helper exited (code=%s) before becoming ready', code);
      reject(
        new Error(
          'Screen capture failed to start. Please check that screen recording permission is granted and try again.',
        ),
      );
    });
  });
}

async function stopNativeCapture(): Promise<string> {
  const proc = captureProc;
  const outPath = captureOutputPath;
  captureProc = null;
  captureOutputPath = null;
  emitRecordingActivityChanged();

  if (!proc || !outPath) {
    throw new Error('[recording] stopNativeCapture called with no active process');
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const stopTimers = [
      setTimeout(() => {
        log.warn('[native:capture] quit grace period elapsed — sending SIGINT');
        trySignalProcess(proc, 'SIGINT', '[native:capture] SIGINT failed:');
      }, STOP_SIGINT_DELAY_MS),
      setTimeout(() => {
        log.warn('[native:capture] still running after SIGINT — sending SIGTERM');
        trySignalProcess(proc, 'SIGTERM', '[native:capture] SIGTERM failed:');
      }, STOP_SIGTERM_DELAY_MS),
      setTimeout(() => {
        log.error('[native:capture] still running after SIGTERM — sending SIGKILL');
        trySignalProcess(proc, 'SIGKILL', '[native:capture] SIGKILL failed:');
      }, STOP_SIGKILL_DELAY_MS),
    ];

    const clearStopTimers = () => {
      for (const timer of stopTimers) {
        clearTimeout(timer);
      }
    };

    const finish = async (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearStopTimers();

      const hasOutput = await fileExistsAndHasData(outPath);
      const canUseAbnormalOutput =
        hasOutput && (process.platform !== 'win32' || (await canReadVideoFrame(outPath)));
      if (code === 0 || canUseAbnormalOutput) {
        if (code !== 0) {
          log.warn(
            '[native:capture] exited abnormally but produced output:',
            'code=',
            code,
            'signal=',
            signal,
            '→',
            outPath,
          );
        }
        resolve(outPath);
        return;
      }

      // On Windows the IMFSinkWriter may have been interrupted before writing the moov
      // atom, leaving the MP4 unreadable. Attempt to recover whatever frames were written.
      if (process.platform === 'win32' && hasOutput) {
        const recoveredPath = await tryRecoverIncompleteCapture(outPath);
        if (recoveredPath) {
          resolve(recoveredPath);
          return;
        }
      }

      reject(
        new Error(`[native:capture] failed to finalize capture (code=${code}, signal=${signal})`),
      );
    };

    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      log.info('[native:capture] exited with code', code, 'signal', signal);
      const moveCount = cursorEvents.filter((e) => e.type === 'move').length;
      const downCount = cursorEvents.filter((e) => e.type === 'mousedown').length;
      const upCount = cursorEvents.filter((e) => e.type === 'mouseup').length;
      const scrollCount = cursorEvents.filter((e) => e.type === 'scroll').length;
      log.info(
        '[native:capture] cursor events captured:',
        `total=${cursorEvents.length}`,
        `move=${moveCount}`,
        `down=${downCount}`,
        `up=${upCount}`,
        `scroll=${scrollCount}`,
      );
      void finish(code, signal);
    };

    proc.once('close', onClose);

    proc.once('error', (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearStopTimers();
      reject(err);
    });

    // Guard against race: if the process already exited before this listener
    // was registered (e.g. it crashed during recording), the 'close' event
    // won't fire again. Drive finish() directly so the promise always settles.
    if (proc.exitCode !== null || proc.signalCode !== null) {
      log.warn(
        '[native:capture] process already exited before stopNativeCapture listener — resolving directly',
      );
      onClose(proc.exitCode, proc.signalCode as NodeJS.Signals | null);
    }

    // Graceful shutdown: send an explicit stop command. Closing stdin remains
    // as a fallback for older helpers that only watch for EOF.
    try {
      proc.stdin?.end('stop\n');
    } catch (err) {
      log.warn('[native:capture] failed to close stdin:', err);
    }
    if (process.platform === 'darwin') {
      // SIGTERM is caught by the Swift signal handler
      trySignalProcess(proc, 'SIGTERM', '[native:capture] initial SIGTERM failed:');
    }
  });
}

// ── Crop recording ────────────────────────────────────────────────────────────

let activeCropArea: { x: number; y: number; width: number; height: number } | null = null;

export function setActiveCropArea(area: {
  x: number;
  y: number;
  width: number;
  height: number;
}): void {
  activeCropArea = area;
}

export function clearActiveCropArea(): void {
  activeCropArea = null;
}

export async function cropRecording(
  filePath: string,
  area: { x: number; y: number; width: number; height: number },
  scaleFactor: number,
): Promise<string> {
  const outPath = createTempPath('screenforge-cropped', 'mp4');
  const px = Math.round(area.x * scaleFactor);
  const py = Math.round(area.y * scaleFactor);
  const pw = Math.round(area.width * scaleFactor);
  const ph = Math.round(area.height * scaleFactor);

  const w = pw % 2 === 0 ? pw : pw - 1;
  const h = ph % 2 === 0 ? ph : ph - 1;

  const fit = fitH264FrameSize(w, h);

  log.info('[recording] cropRecording:', { px, py, w, h, scaleFactor, encodeSize: fit });

  const args = [
    '-y',
    '-i',
    filePath,
    '-vf',
    `crop=${w}:${h}:${px}:${py}` + (fit.scaled ? `,scale=${fit.width}:${fit.height}` : ''),
    ...buildH264EncodeArgs('20000k'),
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    outPath,
  ];

  await runFFmpeg(args, outPath).promise;
  return outPath;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function saveRecording(buffer: ArrayBuffer): Promise<string> {
  const tempPath = createTempPath('screenforge', 'webm');
  await fs.writeFile(tempPath, Buffer.from(buffer));
  return tempPath;
}

/**
 * Saves raw mic audio (webm/opus from MediaRecorder) to a temp file.
 * Distinct from saveRecording(), which is for final export output.
 */
export async function saveAudioCapture(buffer: ArrayBuffer): Promise<string> {
  const tempPath = createTempPath('screenforge-audio', 'webm');
  await fs.writeFile(tempPath, Buffer.from(buffer));
  return tempPath;
}

/**
 * Saves raw camera capture (webm from MediaRecorder) to a temp file.
 */
export async function saveCameraCapture(buffer: ArrayBuffer): Promise<string> {
  const tempPath = createTempPath('screenforge-camera', 'webm');
  await fs.writeFile(tempPath, Buffer.from(buffer));
  return tempPath;
}

/**
 * Remuxes an MP4 produced by IMFSinkWriter (moov at end) so the moov atom sits at
 * the front of the file. Chromium's FFmpeg demuxer fails to seek these files when
 * moov is at the end; faststart eliminates that backward seek entirely.
 * No re-encoding — pure container remux, completes in < 1 s.
 */
async function faststartMp4(inputPath: string): Promise<string> {
  const outputPath = createTempPath('screenforge-fs', 'mp4');
  log.info('[recording] faststart remux starting', { inputPath, outputPath });
  try {
    const args = ['-y', '-i', inputPath, '-movflags', '+faststart', '-c', 'copy', outputPath];
    await runFFmpeg(args, outputPath).promise;
    const inputDuration = await probeMediaDurationMs(inputPath);
    const outputDuration = await probeMediaDurationMs(outputPath);
    log.info('[recording] faststart remux complete', {
      outputPath,
      inputDurationMs: inputDuration,
      outputDurationMs: outputDuration,
      durationChanged: inputDuration !== outputDuration,
    });
    // Return the remuxed file. Leave the original in temp — the OS will clean it up.
    return outputPath;
  } catch (e) {
    if (!(await canReadVideoFrame(inputPath))) {
      await fs.unlink(outputPath).catch(() => undefined);
      throw new Error(`Native recording did not finalize a readable MP4: ${getErrorMessage(e)}`);
    }

    log.warn('[recording] faststart remux failed, using original file:', e);
    await fs.unlink(outputPath).catch(() => undefined);
    return inputPath;
  }
}

/**
 * Merges a video file and a mic audio file into a new temp file.
 * Uses explicit stream mapping to avoid avfoundation silent-track ambiguity on macOS.
 * Uses apad+shortest to pad audio to video length without truncating video.
 * On Windows the merge is pinned to the probed video duration to prevent
 * length mismatches introduced by the native Media Foundation encoder.
 */
export async function mergeAudio(videoPath: string, audioPath: string): Promise<string> {
  const outPath = createTempPath('screenforge-merged', 'mp4');

  const sourceHasAudio = await hasAudioStream(videoPath);
  const targetDurationMs =
    process.platform === 'win32' ? await probeMediaDurationMs(videoPath) : null;
  const args = buildMergeAudioArgs(videoPath, audioPath, outPath, sourceHasAudio, targetDurationMs);

  log.info('[recording] mergeAudio started', {
    sourceHasAudio,
    targetDurationMs,
    enforceVideoDuration: process.platform === 'win32' && targetDurationMs !== null,
  });
  await runFFmpeg(args, outPath).promise;

  if (process.platform === 'win32' && targetDurationMs !== null) {
    const outputDurationMs = await probeMediaDurationMs(outPath);
    const durationDeltaMs =
      outputDurationMs === null ? null : Math.abs(outputDurationMs - targetDurationMs);

    log.info('[recording] mergeAudio duration check', {
      targetDurationMs,
      outputDurationMs,
      durationDeltaMs,
    });

    if (outputDurationMs === null || durationDeltaMs === null || durationDeltaMs > 250) {
      await fs.unlink(outPath).catch(() => undefined);
      throw new Error(
        `Merged output duration mismatch: expected ${targetDurationMs}ms, got ${
          outputDurationMs ?? 'unknown'
        }ms`,
      );
    }
  }

  return outPath;
}

export function activateAppendMode(): void {
  appendMode = true;
}

export function getAppendMode(): boolean {
  return appendMode;
}

export function clearAppendMode(): void {
  appendMode = false;
}

export async function concatRecordings(firstPath: string, secondPath: string): Promise<string> {
  const outPath = createTempPath('screenforge-concat', 'mp4');

  // Probe dimensions for output sizing. We always re-encode rather than stream-copying
  // because desktop and window recordings come from different capture pipelines
  // (getUserMedia vs ScreenCaptureKit) and produce incompatible SPS/PPS even at the same
  // resolution. Bitstream copy causes a VideoToolbox -12909 decode error in Chromium
  // when seeking into the second segment.
  const [firstInfo] = await Promise.all([
    probeExportSource(firstPath),
    probeExportSource(secondPath),
  ]);

  // The first clip sets the size, capped to what the H.264 encoder accepts;
  // when it's capped, the first clip is scaled down too.
  const fit = fitH264FrameSize(firstInfo.width ?? 1280, firstInfo.height ?? 800);
  const { width: w, height: h } = fit;
  const scaleFilter = [
    `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
    'setsar=1',
    'format=yuv420p',
  ].join(',');

  const [firstHasAudio, secondHasAudio] = await Promise.all([
    hasAudioStream(firstPath),
    hasAudioStream(secondPath),
  ]);
  const withAudio = firstHasAudio && secondHasAudio;

  const filterParts = [
    fit.scaled ? `[0:v]${scaleFilter}[v0]` : `[0:v]format=yuv420p,setsar=1[v0]`,
    `[1:v]${scaleFilter}[v1]`,
  ];

  if (withAudio) {
    filterParts.push(
      `[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0]`,
      `[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a1]`,
      `[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]`,
    );
  } else {
    filterParts.push(`[v0][v1]concat=n=2:v=1:a=0[outv]`);
  }

  const filterComplex = filterParts.join(';');
  const audioArgs = withAudio
    ? ['-map', '[outa]', '-c:a', 'aac', '-ar', '44100', '-ac', '2']
    : ['-an'];

  const args = [
    '-y',
    '-i',
    firstPath,
    '-i',
    secondPath,
    '-filter_complex',
    filterComplex,
    '-map',
    '[outv]',
    ...audioArgs,
    ...buildH264EncodeArgs('20000k'),
    '-r',
    '30',
    '-movflags',
    '+faststart',
    outPath,
  ];
  await runFFmpeg(args, outPath).promise;

  return outPath;
}

// Re-encodes a video file in-place to a clean H.264/AAC stream, fixing corrupt
// concat files produced by the old -c copy path (VT -12909 decode error).
export async function reencodeRecording(filePath: string): Promise<string> {
  const tempPath = createTempPath('screenforge-reencode', 'mp4');
  const [sourceHasAudio, source] = await Promise.all([
    hasAudioStream(filePath),
    probeExportSource(filePath),
  ]);
  const fit = source.width && source.height ? fitH264FrameSize(source.width, source.height) : null;

  const audioArgs = sourceHasAudio ? ['-c:a', 'aac', '-ar', '44100', '-ac', '2'] : ['-an'];

  const args = [
    '-y',
    '-i',
    filePath,
    '-vf',
    (fit?.scaled ? `scale=${fit.width}:${fit.height},` : '') + 'format=yuv420p,setsar=1',
    ...buildH264EncodeArgs('20000k'),
    '-r',
    '30',
    ...audioArgs,
    '-movflags',
    '+faststart',
    tempPath,
  ];

  log.info('[recording] reencodeRecording: started');
  await runFFmpeg(args, tempPath).promise;

  // Overwrite the original in-place so the project JSON reference stays valid.
  await fs.copyFile(tempPath, filePath);
  await fs.unlink(tempPath).catch(() => undefined);
  log.info('[recording] reencodeRecording: done');
  return filePath;
}

async function resolveWindowRecordingStartArea(sourceId: string): Promise<RecordingBoundsSample> {
  const windowId = parseWindowIdFromSourceId(sourceId);
  if (windowId === null) {
    throw new Error('Could not resolve the selected window.');
  }

  // Linux X11: the source id embeds the X window id; xwininfo resolves it to
  // absolute screen bounds (no native helper on this platform).
  if (process.platform === 'linux') {
    const bounds = await getX11WindowGeometry(windowId);
    return { timestamp: Date.now(), ...bounds };
  }

  const metadata = await getMacWindowMetadata();
  const windowInfo = metadata.get(windowId);
  if (
    !windowInfo ||
    typeof windowInfo.x !== 'number' ||
    typeof windowInfo.y !== 'number' ||
    typeof windowInfo.width !== 'number' ||
    typeof windowInfo.height !== 'number'
  ) {
    throw new Error('Could not read the selected window bounds.');
  }

  return {
    timestamp: Date.now(),
    x: windowInfo.x,
    y: windowInfo.y,
    width: windowInfo.width,
    height: windowInfo.height,
    scaleFactor: windowInfo.scaleFactor,
  };
}

export async function startRecording(
  sourceId: string,
  cropArea?: { x: number; y: number; width: number; height: number } | null,
  options?: { rendererCapture?: boolean },
): Promise<void> {
  const startedAt = Date.now();
  log.info('[recording] start requested', {
    sourceId,
    packaged: app.isPackaged,
    nativeCapture: shouldUseNativeCapture(),
    captureBackend: getCaptureBackend(),
    rendererCapture: options?.rendererCapture === true,
    cropArea,
  });

  await prepareRecordingStartPermissionsIfNeeded();

  cursorEvents = [];
  recordingBoundsTimeline = [];
  recordingPaused = false;
  recordingPauseSpans = [];
  nativeMediaStartTime = null;
  activeWindowRecording = false;
  lastMoveX = -1;
  lastMoveY = -1;
  lastMoveMs = 0;

  if (cropArea) {
    setActiveCropArea(cropArea);
  } else {
    clearActiveCropArea();
  }

  const isWindowCapture = isWindowSource(sourceId);
  const isLinuxX11 = process.platform === 'linux' && getLinuxSessionType() === 'x11';

  if (isWindowCapture && !shouldUseNativeCapture() && !isLinuxX11) {
    if (process.platform === 'darwin' && app.isPackaged) {
      throw new Error(
        'Window-only recording is temporarily unavailable in packaged macOS builds. Use display recording for now.',
      );
    }

    throw new Error(
      'Window-only recording is currently supported on macOS 13+, Windows, and Linux (X11).',
    );
  }

  let display = resolveDisplayForSource(sourceId);
  const sourceDisplayId = parseDisplayIdFromSource(sourceId);
  const sourceWindowId = parseWindowIdFromSourceId(sourceId);

  if (isWindowCapture) {
    let initialBounds = await resolveWindowRecordingStartArea(sourceId);
    if (isLinuxX11) {
      // x11grab grabs a fixed root-window region, which must stay inside the
      // display and have even dimensions (yuv420p). Clamp against the display
      // the window actually sits on, not whatever resolveDisplayForSource
      // fell back to for a window: source id.
      display = screen.getDisplayNearestPoint({
        x: Math.round(initialBounds.x + initialBounds.width / 2),
        y: Math.round(initialBounds.y + initialBounds.height / 2),
      });
      const clamped = clampCaptureBounds(initialBounds, display.bounds);
      if (!clamped) {
        throw new Error('The selected window is not visible on screen.');
      }
      initialBounds = { ...initialBounds, ...clamped };
    }
    recordingArea = {
      x: initialBounds.x,
      y: initialBounds.y,
      width: initialBounds.width,
      height: initialBounds.height,
    };
    ensureRecordingBoundsSample(initialBounds);
    activeWindowRecording = true;
  } else {
    recordingArea = display.bounds;
  }

  // Wayland: the renderer owns the capture (PipeWire portal stream recorded
  // with MediaRecorder). The main process only anchors timing here; the webm
  // arrives via stopRecording(). Global input hooks are blocked on Wayland,
  // so cursor tracking is skipped and cursor effects degrade gracefully.
  if (process.platform === 'linux' && isWaylandSession()) {
    if (!options?.rendererCapture) {
      throw new Error(
        'Screen recording on Wayland uses the system screen-share dialog, which could not be started. Please try again.',
      );
    }
    rendererCaptureActive = true;
    emitRecordingActivityChanged();
    recordingStartTime = Date.now();
    log.info('[recording:wayland] renderer capture started', {
      recordingStartTime,
      startupLatencyMs: Date.now() - startedAt,
    });
    return;
  }

  const outPath = createTempPath('screenforge', 'mp4');

  if (shouldUseNativeCapture()) {
    log.info('[recording] using native capture helper');
    await startNativeCapture(display, outPath, sourceDisplayId, sourceWindowId);
    recordingStartTime = Date.now();
    log.info('[recording:native] recordingStartTime set after "Recording started"', {
      recordingStartTime,
      nativeMediaStartTimeAtSet: nativeMediaStartTime,
      alreadyHaveMediaStart: nativeMediaStartTime !== null,
    });
    if (activeWindowRecording && recordingBoundsTimeline.length === 0) {
      ensureRecordingBoundsSample({ ...recordingArea, timestamp: recordingStartTime });
    }
    // CGEventTap in the helper replaces uiohook-napi on macOS 13+
  } else {
    const bin = await getFFmpegPath();
    const captureArea = isWindowCapture && recordingArea ? recordingArea : undefined;
    ffmpegCaptureSpawn = {
      bin,
      buildArgs: (segmentPath) => buildCaptureArgs(display, segmentPath, captureArea),
    };
    ffmpegSegments = [];
    ffmpegSegmentTransition = Promise.resolve();

    // Wait until FFmpeg opens the output file before starting mouse tracking.
    try {
      await startFFmpegSegment(outPath);
    } catch (error) {
      ffmpegCaptureSpawn = null;
      emitRecordingActivityChanged();
      throw error;
    }

    recordingStartTime = Date.now();
    try {
      await startCursorTracking();
    } catch (error) {
      await stopFFmpegCapture().catch(() => undefined);
      throw error;
    }
  }

  log.info('[recording] start completed', {
    sourceId,
    outputPath: outPath,
    startupLatencyMs: Date.now() - startedAt,
  });
}

export async function stopRecording(rendererCapture?: {
  webmPath: string;
  width?: number;
  height?: number;
}): Promise<{
  events: CursorEvent[];
  startTime: number;
  stopTime: number;
  durationMs: number;
  recordingArea: RecordingArea;
  captureBoundsTimeline?: RecordingBoundsSample[];
  hasEmbeddedAudio: boolean;
  filePath: string;
}> {
  log.info('[recording] stop requested');
  // Let an in-flight FFmpeg pause/resume settle so its pause span is closed.
  await ffmpegSegmentTransition;
  const wallStopTime = Date.now();
  const pauseSpans = finalizePauseSpans(recordingPauseSpans, wallStopTime);
  const wallStopTimeActive = computeActiveStopTime(recordingStartTime, wallStopTime, pauseSpans);
  const wallDurationMs = computeActiveDurationMs(recordingStartTime, wallStopTime, pauseSpans);
  let filePath: string;

  if (rendererCaptureActive) {
    rendererCaptureActive = false;
    emitRecordingActivityChanged();
    if (!rendererCapture?.webmPath) {
      throw new Error('The screen capture stream did not produce any video data.');
    }
    filePath = await finalizeRendererCapture(rendererCapture.webmPath);
    // The portal stream's pixel size is the authoritative capture area on
    // Wayland (the user may have picked any screen or window in the picker).
    if (
      typeof rendererCapture.width === 'number' &&
      typeof rendererCapture.height === 'number' &&
      rendererCapture.width > 0 &&
      rendererCapture.height > 0
    ) {
      recordingArea = {
        x: 0,
        y: 0,
        width: rendererCapture.width,
        height: rendererCapture.height,
      };
    }
  } else if (captureProc) {
    filePath = await stopNativeCapture();
    if (process.platform === 'win32') {
      filePath = await faststartMp4(filePath);
    }
  } else {
    stopCursorTracking();
    filePath = await stopFFmpegCapture();
  }

  // Apply crop if an active crop area was set before recording started
  const cropAreaToApply = activeCropArea;
  clearActiveCropArea();

  if (cropAreaToApply) {
    try {
      const display = screen.getPrimaryDisplay();
      const scaleFactor = display.scaleFactor ?? 1;
      log.info('[recording] applying crop area', { cropAreaToApply, scaleFactor });
      filePath = await cropRecording(filePath, cropAreaToApply, scaleFactor);
      recordingArea = {
        x: cropAreaToApply.x,
        y: cropAreaToApply.y,
        width: cropAreaToApply.width,
        height: cropAreaToApply.height,
      };
    } catch (err) {
      log.error('[recording] cropRecording failed, using uncropped output:', err);
    }
  }

  const hasEmbeddedAudio = await hasAudioStream(filePath);
  const mediaDurationMs = await probeMediaDurationMs(filePath);

  // ── Timing diagnostics ─────────────────────────────────────────────────────
  // The native Windows encoder starts its media timeline when the sink writer is
  // ready, which can lag the wall-clock start. Anchor cursor events and duration
  // to the media timeline when available so video and overlays stay in sync.
  const effectiveStartTime = nativeMediaStartTime ?? recordingStartTime;
  const usedNativeMediaStart = nativeMediaStartTime !== null;
  const fallbackDurationMs =
    effectiveStartTime === recordingStartTime
      ? wallDurationMs
      : Math.max(0, wallStopTime - effectiveStartTime);
  const effectiveDurationMs = mediaDurationMs ?? fallbackDurationMs;
  const effectiveStopTime =
    effectiveDurationMs > 0
      ? effectiveStartTime + effectiveDurationMs
      : Math.max(effectiveStartTime, wallStopTimeActive);

  log.info('[recording] stop completed', {
    filePath,
    hasEmbeddedAudio,
    // Wall-clock timing
    recordingStartTime,
    wallStopTime,
    wallDurationMs,
    // Native encoder timing
    nativeMediaStartTime,
    usedNativeMediaStart,
    mediaStartOffsetMs:
      nativeMediaStartTime !== null ? nativeMediaStartTime - recordingStartTime : null,
    // Duration resolution
    mediaDurationMs,
    fallbackDurationMs,
    usedFallback: mediaDurationMs === null,
    // Final timeline values
    effectiveStartTime,
    effectiveDurationMs,
    effectiveStopTime,
    timelineGapMs: effectiveStartTime - recordingStartTime,
    // Content
    eventCount: cursorEvents.length,
    hasBoundsTimeline: activeWindowRecording,
    pauseSpanCount: pauseSpans.length,
  });

  // Warn if effective duration is much shorter than wall time (indicates dropped content).
  if (wallDurationMs > 0 && effectiveDurationMs < wallDurationMs * 0.9) {
    log.warn('[recording] effective duration significantly shorter than wall time', {
      lostMs: wallDurationMs - effectiveDurationMs,
      ratio: Math.round((effectiveDurationMs / wallDurationMs) * 100),
    });
  }

  log.info('[recording] cursor timing summary', {
    recordingStartAnchor: summarizeCursorEvents(
      cursorEvents,
      recordingStartTime,
      wallStopTimeActive,
    ),
    mediaStartAnchor: summarizeCursorEvents(cursorEvents, effectiveStartTime, effectiveStopTime),
  });

  const events = normalizeTimestampedEntries(
    cursorEvents.filter((event) => event.timestamp >= effectiveStartTime),
    effectiveStartTime,
    pauseSpans,
  ).filter((event) => event.timestamp <= effectiveStopTime);
  const boundsTimelineSource = recordingBoundsTimeline.filter(
    (sample) => sample.timestamp >= effectiveStartTime,
  );
  const captureBoundsTimeline = activeWindowRecording
    ? normalizeTimestampedEntries(
        boundsTimelineSource.length > 0
          ? boundsTimelineSource
          : [{ ...recordingArea, timestamp: effectiveStartTime }],
        effectiveStartTime,
        pauseSpans,
      ).filter((sample) => sample.timestamp <= effectiveStopTime)
    : undefined;

  log.info('[recording] cursor timing normalized', {
    normalizedCursor: summarizeCursorEvents(events, effectiveStartTime, effectiveStopTime),
  });

  // Free the raw event arrays — data is now in the normalized return value.
  cursorEvents = [];
  recordingBoundsTimeline = [];

  trackMemorySnapshot('after_recording');

  return {
    events,
    startTime: effectiveStartTime,
    stopTime: effectiveStopTime,
    durationMs: effectiveDurationMs,
    recordingArea,
    captureBoundsTimeline,
    hasEmbeddedAudio,
    filePath,
  };
}

export async function discardRecording(): Promise<void> {
  log.info('[recording] discard requested');
  appendMode = false;
  clearActiveCropArea();

  let filePaths: string[] = [];
  try {
    if (rendererCaptureActive) {
      // Wayland: the renderer discards its own MediaRecorder chunks.
      rendererCaptureActive = false;
      emitRecordingActivityChanged();
    } else if (captureProc) {
      filePaths = [await stopNativeCapture()];
    } else {
      stopCursorTracking();
      // No need to join segments that are about to be deleted.
      filePaths = (await collectFFmpegSegments()).map((segment) => segment.path);
    }
  } catch (err) {
    log.warn('[recording] discard: stop capture failed (continuing cleanup):', err);
  }

  cursorEvents = [];
  recordingBoundsTimeline = [];

  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
      log.info('[recording] discard: temp file deleted');
    } catch (err) {
      log.warn('[recording] discard: could not delete temp file:', err);
    }
  }
}

export function pauseRecording(): void {
  if (recordingPaused) {
    return;
  }

  recordingPaused = true;
  recordingPauseSpans.push({
    startTime: Date.now(),
    endTime: null,
  });

  if (rendererCaptureActive) {
    // Wayland: the renderer pauses its own MediaRecorder; only the pause-span
    // bookkeeping above is needed here.
    return;
  }

  if (captureProc) {
    // Use stdin message instead of SIGSTOP to avoid AVAssetWriter timestamp corruption
    try {
      captureProc.stdin?.write('pause\n');
    } catch (err) {
      log.warn('[native:capture] failed to send pause to stdin:', err);
    }
  } else {
    const pausedAt = Date.now();
    ffmpegSegmentTransition = ffmpegSegmentTransition
      .then(() => finishFFmpegSegment(pausedAt))
      .catch((err) => log.error('[recording] pause: failed to finalize capture segment:', err));
  }
}

export function resumeRecording(): void {
  if (!recordingPaused) {
    return;
  }

  recordingPaused = false;
  const activePauseSpan = recordingPauseSpans[recordingPauseSpans.length - 1];
  const endPauseSpan = () => {
    if (activePauseSpan && activePauseSpan.endTime === null) {
      activePauseSpan.endTime = Date.now();
    }
  };

  if (rendererCaptureActive) {
    endPauseSpan();
    return;
  }

  if (captureProc) {
    endPauseSpan();
    try {
      captureProc.stdin?.write('resume\n');
    } catch (err) {
      log.warn('[native:capture] failed to send resume to stdin:', err);
    }
  } else {
    // The pause ends when the new segment is actually capturing — the same
    // anchor startRecording() uses for recordingStartTime.
    ffmpegSegmentTransition = ffmpegSegmentTransition
      .then(startNextFFmpegSegment)
      .catch((err) => log.error('[recording] resume: failed to start capture segment:', err))
      .finally(endPauseSpan);
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Resolves when FFmpeg prints "Output #0" to stderr, which means the muxer
 * is open and the first frame is about to be captured. On macOS AVFoundation
 * can start emitting other "we're live" lines first, so we accept those too.
 * Falls back after a few seconds so a slow machine never blocks recording
 * from starting.
 */
function waitForFFmpegCapturing(proc: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let stderrBuffer = '';
    const recentLines: string[] = [];

    const finish = (timedOut = false) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(fallback);
      proc.stderr?.removeListener('data', onData);
      attachFFmpegCaptureLogger(proc);
      if (timedOut) {
        log.warn('[ffmpeg:capture] timed out waiting for ready signal — starting anyway');
      }
      resolve();
    };

    // FFmpeg exiting before it signalled "capturing" means startup failed
    // (bad encoder, unavailable display, …). Surface the error immediately
    // instead of pretending the recording started.
    const fail = (code: number | null) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(fallback);
      proc.stderr?.removeListener('data', onData);
      const errorLine =
        recentLines.filter((line) => /error/i.test(line)).pop() ??
        recentLines[recentLines.length - 1] ??
        `exit code ${code}`;
      reject(new Error(`Screen capture failed to start: ${errorLine}`));
    };

    const fallback = setTimeout(() => finish(true), CAPTURE_READY_TIMEOUT_MS);

    const onData = (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const normalized = line.trim();
        if (!normalized) {
          continue;
        }

        log.info('[ffmpeg:capture]', normalized);
        recentLines.push(normalized);
        if (recentLines.length > 20) {
          recentLines.shift();
        }
        if (isFFmpegCaptureReadyLine(normalized)) {
          finish();
          break;
        }
      }
    };

    proc.stderr?.on('data', onData);
    proc.once('close', (code) => fail(code));
  });
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  try {
    const bin = await getFFmpegPath();

    return await new Promise<boolean>((resolve) => {
      const proc = spawn(bin, ['-hide_banner', '-i', filePath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let stderr = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.once('error', (error) => {
        log.warn('[recording] audio stream probe failed to spawn:', error);
        resolve(false);
      });

      proc.once('close', () => {
        resolve(/\bAudio:/.test(stderr));
      });
    });
  } catch (error) {
    log.warn('[recording] audio stream probe failed:', error);
    return false;
  }
}

async function probeMediaDurationMs(filePath: string): Promise<number | null> {
  try {
    const bin = await getFFmpegPath();

    return await new Promise<number | null>((resolve) => {
      const proc = spawn(bin, ['-hide_banner', '-i', filePath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      let stderr = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve(null);
      }, 8000);

      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.once('error', (error) => {
        clearTimeout(timeout);
        log.warn('[recording] media duration probe failed to spawn:', error);
        resolve(null);
      });

      proc.once('close', () => {
        clearTimeout(timeout);
        const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (!match) {
          log.warn('[recording] duration probe: no Duration match in ffmpeg output', {
            stderrSnippet: stderr.slice(0, 500),
          });
          resolve(null);
          return;
        }

        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const seconds = Number(match[3]);
        const durationSeconds = hours * 3600 + minutes * 60 + seconds;
        const result = Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null;
        resolve(result);
      });
    });
  } catch (error) {
    log.warn('[recording] media duration probe failed:', error);
    return null;
  }
}

async function tryRecoverIncompleteCapture(inputPath: string): Promise<string | null> {
  const outputPath = createTempPath('screenforge-recovered', 'mp4');
  try {
    const bin = await getFFmpegPath();
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        bin,
        [
          '-y',
          '-fflags',
          '+igndts+discardcorrupt',
          '-i',
          inputPath,
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          outputPath,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('recovery timed out'));
      }, 20000);
      proc.once('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`recovery exited with code ${code}`));
        }
      });
      proc.once('error', reject);
    });

    if (await canReadVideoFrame(outputPath)) {
      log.info('[native:capture] incomplete capture recovered via FFmpeg remux:', outputPath);
      return outputPath;
    }
  } catch (err) {
    log.warn('[native:capture] incomplete capture recovery failed:', err);
  }

  await fs.unlink(outputPath).catch(() => undefined);
  return null;
}

async function canReadVideoFrame(filePath: string): Promise<boolean> {
  try {
    const bin = await getFFmpegPath();

    return await new Promise<boolean>((resolve) => {
      const proc = spawn(
        bin,
        ['-v', 'error', '-i', filePath, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'],
        {
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve(false);
      }, 8000);

      proc.once('error', (error) => {
        clearTimeout(timeout);
        log.warn('[recording] video readability probe failed to spawn:', error);
        resolve(false);
      });

      proc.once('close', (code) => {
        clearTimeout(timeout);
        resolve(code === 0);
      });
    });
  } catch (error) {
    log.warn('[recording] video readability probe failed:', error);
    return false;
  }
}

function isFFmpegCaptureReadyLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('Output #0') ||
    normalized.includes('Press [q] to stop') ||
    normalized.startsWith('frame=')
  );
}

function attachFFmpegCaptureLogger(proc: ChildProcess): void {
  proc.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      log.info('[ffmpeg:capture]', line);
    }
  });
}

/** Spawns one FFmpeg capture segment and waits until it is capturing. */
async function startFFmpegSegment(outPath: string): Promise<void> {
  if (!ffmpegCaptureSpawn) {
    throw new Error('[recording] startFFmpegSegment called with no FFmpeg recording');
  }

  const args = ffmpegCaptureSpawn.buildArgs(outPath);
  log.info('[recording] FFmpeg args:', args.join(' '));

  const proc = spawn(ffmpegCaptureSpawn.bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  ffmpegProc = proc;
  ffmpegOutputPath = outPath;
  emitRecordingActivityChanged();

  proc.on('error', (err) => log.error('[ffmpeg:capture] spawn error:', err));

  try {
    await waitForFFmpegCapturing(proc);
  } catch (error) {
    ffmpegProc = null;
    ffmpegOutputPath = null;
    emitRecordingActivityChanged();
    throw error;
  }
  ffmpegSegmentStartedAt = Date.now();
}

async function startNextFFmpegSegment(): Promise<void> {
  if (!ffmpegCaptureSpawn || ffmpegProc) {
    return;
  }
  await startFFmpegSegment(createTempPath('screenforge', 'mp4'));
  log.info('[recording] resumed into a new capture segment', {
    segmentIndex: ffmpegSegments.length,
  });
}

/**
 * Gracefully ends the running segment and queues it for joining, cut at the
 * moment pause was pressed — FFmpeg keeps grabbing for a few hundred ms while
 * it shuts down, and that tail would push every later segment out of sync.
 */
async function finishFFmpegSegment(pausedAt: number): Promise<void> {
  const proc = ffmpegProc;
  const outPath = ffmpegOutputPath;
  ffmpegProc = null;
  ffmpegOutputPath = null;

  if (!proc || !outPath) {
    return;
  }
  const segmentPath = await quitFFmpegProcess(proc, outPath);
  // Snap down to a frame boundary so the join never leaves a sliver frame,
  // and keep at least the first frame even when pause landed before (or
  // right as) the segment began capturing.
  const frames = Math.max(
    1,
    Math.floor((pausedAt - ffmpegSegmentStartedAt) / FFMPEG_CAPTURE_FRAME_MS),
  );
  const outpointMs = frames * FFMPEG_CAPTURE_FRAME_MS;
  ffmpegSegments.push({ path: segmentPath, outpointMs });
}

/** Ends the FFmpeg recording and returns every segment, in order. */
async function collectFFmpegSegments(): Promise<CaptureSegment[]> {
  await ffmpegSegmentTransition;

  const proc = ffmpegProc;
  const outPath = ffmpegOutputPath;
  const segments = ffmpegSegments;
  ffmpegProc = null;
  ffmpegOutputPath = null;
  ffmpegSegments = [];
  ffmpegCaptureSpawn = null;
  emitRecordingActivityChanged();

  if (proc && outPath) {
    try {
      // The last segment keeps its tail, matching an unpaused recording.
      segments.push({ path: await quitFFmpegProcess(proc, outPath) });
    } catch (error) {
      // Earlier segments are still usable — only fail when nothing was captured.
      if (segments.length === 0) {
        throw error;
      }
      log.error(
        '[recording] last capture segment failed to finalize — keeping earlier ones:',
        error,
      );
    }
  }

  if (segments.length === 0) {
    throw new Error('[recording] stopFFmpegCapture called with no active process');
  }
  return segments;
}

async function joinFFmpegSegments(segments: CaptureSegment[]): Promise<string> {
  const listPath = createTempPath('screenforge-segments', 'txt');
  const outPath = createTempPath('screenforge-joined', 'mp4');

  await fs.writeFile(listPath, buildSegmentConcatList(segments), 'utf8');
  try {
    await runFFmpeg(buildSegmentConcatArgs(listPath, outPath), outPath).promise;
  } finally {
    await fs.unlink(listPath).catch(() => undefined);
  }

  // Segments are only removed once the joined file exists, so a failed join
  // leaves the raw capture on disk instead of losing it.
  await Promise.all(segments.map((segment) => fs.unlink(segment.path).catch(() => undefined)));
  log.info('[recording] joined capture segments', { segmentCount: segments.length, outPath });
  return outPath;
}

async function stopFFmpegCapture(): Promise<string> {
  const segments = await collectFFmpegSegments();
  return segments.length === 1 ? segments[0].path : joinFFmpegSegments(segments);
}

async function quitFFmpegProcess(proc: ChildProcess, outPath: string): Promise<string> {
  const alreadyExited = proc.exitCode !== null || proc.signalCode !== null;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const stopTimers = [
      setTimeout(() => {
        log.warn('[ffmpeg:capture] quit grace period elapsed — sending SIGINT');
        trySignalProcess(proc, 'SIGINT', '[ffmpeg:capture] SIGINT failed:');
      }, STOP_SIGINT_DELAY_MS),
      setTimeout(() => {
        log.warn('[ffmpeg:capture] still running after SIGINT — sending SIGTERM');
        trySignalProcess(proc, 'SIGTERM', '[ffmpeg:capture] SIGTERM failed:');
      }, STOP_SIGTERM_DELAY_MS),
      setTimeout(() => {
        log.error('[ffmpeg:capture] still running after SIGTERM — sending SIGKILL');
        trySignalProcess(proc, 'SIGKILL', '[ffmpeg:capture] SIGKILL failed:');
      }, STOP_SIGKILL_DELAY_MS),
    ];

    const clearStopTimers = () => {
      for (const timer of stopTimers) {
        clearTimeout(timer);
      }
    };

    const finish = async (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearStopTimers();

      const hasOutput = await fileExistsAndHasData(outPath);
      if (code === 0 || hasOutput) {
        if (code !== 0) {
          log.warn(
            '[ffmpeg:capture] exited abnormally but produced output:',
            'code=',
            code,
            'signal=',
            signal,
            '→',
            outPath,
          );
        }
        resolve(outPath);
        return;
      }

      reject(
        new Error(`[ffmpeg:capture] failed to finalize capture (code=${code}, signal=${signal})`),
      );
    };

    proc.once('close', (code, signal) => {
      log.info('[ffmpeg:capture] exited with code', code, 'signal', signal);
      void finish(code, signal);
    });

    proc.once('error', (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearStopTimers();
      reject(err);
    });

    // Process died earlier (e.g. crashed mid-recording): 'close' has already
    // fired and will never fire again — finalize from the recorded exit state
    // instead of waiting for the kill-escalation timers to run dry.
    if (alreadyExited) {
      log.warn('[ffmpeg:capture] process already exited before stop', {
        code: proc.exitCode,
        signal: proc.signalCode,
      });
      void finish(proc.exitCode, proc.signalCode);
      return;
    }

    // Send 'q' to stdin first — FFmpeg's graceful shutdown signal.
    try {
      proc.stdin?.write('q\n');
      proc.stdin?.end();
    } catch (err) {
      log.warn('[ffmpeg:capture] failed to send q to stdin, falling back to SIGINT:', err);
      trySignalProcess(proc, 'SIGINT', '[ffmpeg:capture] fallback SIGINT failed:');
    }
  });
}

async function fileExistsAndHasData(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}
