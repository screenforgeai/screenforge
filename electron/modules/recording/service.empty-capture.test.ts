// @vitest-environment node

// A 0.7.0 macOS report (PostHog, 2026-11-09): a window recording started only
// after the 8s ready timeout, ScreenCaptureKit never delivered a frame, the
// helper still exited 0, and the app saved a "59s" recording backed by an empty
// file, whose export then failed with "416 Requested Range Not Satisfiable".
// These run the real recording service; only the native helper and ffmpeg are
// faked, from what they do (see fakeHelper/fakeProbe).

import { EventEmitter } from 'node:events';
import { statSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessMock = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn() }));
const electronMock = vi.hoisted(() => ({ tempDir: '' }));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/dev/project',
    getPath: () => electronMock.tempDir,
  },
  screen: {
    getAllDisplays: () => [],
    getPrimaryDisplay: () => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1512, height: 982 },
      scaleFactor: 2,
    }),
  },
}));
vi.mock('node:child_process', () => ({
  spawn: childProcessMock.spawn,
  execFile: childProcessMock.execFile,
}));
vi.mock('uiohook-napi', () => ({
  uIOhook: { on: vi.fn(), start: vi.fn(), stop: vi.fn(), removeAllListeners: vi.fn() },
}));
vi.mock('../ffmpeg/index', () => ({ getFFmpegPath: vi.fn().mockResolvedValue('/bin/ffmpeg') }));
vi.mock('../ffmpeg/runner', () => ({ runFFmpeg: vi.fn() }));
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/telemetry', () => ({ trackMemorySnapshot: vi.fn() }));
vi.mock('../../lib/macos-native-capture', () => ({
  shouldUseMacNativeCapture: vi.fn(() => true),
  shouldUseNativeCapture: vi.fn(() => true),
}));
vi.mock('../app/service', () => ({
  prepareRecordingStartPermissionsIfNeeded: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../sources/service', () => ({
  getMacWindowMetadata: vi
    .fn()
    .mockResolvedValue(
      new Map([[4242, { x: 100, y: 80, width: 1200, height: 760, scaleFactor: 2 }]]),
    ),
  parseWindowIdFromSourceId: vi.fn(() => 4242),
}));
vi.mock('../export/service', () => ({ probeExportSource: vi.fn() }));

const realPlatform = process.platform;
// CAPTURE_READY_TIMEOUT_MS and the stop path are chosen per platform at import.
Object.defineProperty(process, 'platform', { value: 'darwin' });
const { startRecording, stopRecording } = await import('./service');

/**
 * ScreenforgeCapture (native/macos). AVAssetWriter's startWriting creates the
 * output file up front; "Recording started" is printed on the first complete
 * frame. The app stops it with SIGTERM (its stdin reader only handles pause and
 * resume), and gracefulShutdown() finalizes the writer and exits 0, even with
 * zero frames written.
 */
const HELPER_PID = 424_242;
let helperExit: (() => void) | null = null;

function fakeHelper({ frames, exitCode }: { frames: boolean; exitCode: number }) {
  return (_bin: string, args: string[]) => {
    const outPath = args[args.indexOf('--output') + 1];
    const proc = Object.assign(new EventEmitter(), {
      pid: HELPER_PID,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { end: vi.fn() },
      exitCode: null as number | null,
      signalCode: null,
    });
    writeFileSync(outPath, '');
    queueMicrotask(() => {
      proc.stderr.emit('data', Buffer.from('[CaptureEngine] shareable content: displays=1\n'));
      if (frames) {
        writeFileSync(outPath, 'mp4 frames');
        proc.stderr.emit('data', Buffer.from('Recording started\n'));
      }
    });
    helperExit = () => {
      helperExit = null;
      if (!frames) {
        proc.stderr.emit(
          'data',
          Buffer.from('[CaptureEngine] warning: finalizing with zero frames written\n'),
        );
      }
      proc.exitCode = exitCode;
      queueMicrotask(() => proc.emit('close', exitCode, null));
    };
    return proc;
  };
}

/** `ffmpeg -i`, as the bundled ffmpeg answers for an empty and a 59s mp4. */
function fakeProbe(args: string[]) {
  const filePath = args[args.indexOf('-i') + 1];
  const empty = statSync(filePath).size === 0;
  const proc = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), kill: vi.fn() });
  queueMicrotask(() => {
    proc.stderr.emit(
      'data',
      Buffer.from(
        empty
          ? '[mov,mp4,m4a,3gp,3g2,mj2 @ 0x1] moov atom not found\n' +
              '[in#0 @ 0x2] Error opening input: Invalid data found when processing input\n'
          : '  Duration: 00:00:59.00, start: 0.000000, bitrate: 9000 kb/s\n',
      ),
    );
    proc.emit('close', empty ? 183 : 1);
  });
  return proc;
}

function spawnHelper(helper: { frames: boolean; exitCode: number }) {
  childProcessMock.spawn.mockImplementation((bin: string, args: string[], opts: unknown) =>
    bin === '/bin/ffmpeg' ? fakeProbe(args) : fakeHelper(helper)(bin, args, opts),
  );
}

/** Starts a window recording and lets it run as long as the reported one (59s). */
async function recordFor59s() {
  let started = false;
  const start = startRecording('window:4242:0').then(() => {
    started = true;
  });
  await vi.advanceTimersByTimeAsync(7_999);
  const startedBeforeTimeout = started;
  await vi.advanceTimersByTimeAsync(1);
  await start;
  await vi.advanceTimersByTimeAsync(59_000);
  return { startedBeforeTimeout };
}

describe('stopping a macOS native recording', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    electronMock.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-empty-capture-'));
  });

  afterAll(async () => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
    await fs.rm(electronMock.tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const realKill = process.kill.bind(process);
    killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid !== HELPER_PID) {
        return realKill(pid, signal);
      }
      if (signal === 'SIGTERM' || signal === 'SIGINT') {
        helperExit?.();
      }
      return true;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    killSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('keeps a normal recording: it starts on the first frame and takes the probed duration', async () => {
    spawnHelper({ frames: true, exitCode: 0 });

    const { startedBeforeTimeout } = await recordFor59s();
    const result = await stopRecording();

    expect(startedBeforeTimeout).toBe(true);
    expect((await fs.stat(result.filePath)).size).toBeGreaterThan(0);
    expect(result.durationMs).toBe(59_000);
  });

  it('keeps a recording the helper wrote before exiting abnormally', async () => {
    spawnHelper({ frames: true, exitCode: 1 });
    await recordFor59s();

    const result = await stopRecording();

    expect((await fs.stat(result.filePath)).size).toBeGreaterThan(0);
  });

  // Slow machines still record; only an empty result is a failure.
  it('still starts after the 8s ready timeout when no frame has arrived yet', async () => {
    spawnHelper({ frames: false, exitCode: 0 });

    const { startedBeforeTimeout } = await recordFor59s();

    expect(startedBeforeTimeout).toBe(false);
    await stopRecording().catch(() => undefined);
  });

  it('fails with a clear message when nothing was captured, though the helper exits 0', async () => {
    spawnHelper({ frames: false, exitCode: 0 });
    await recordFor59s();

    await expect(stopRecording()).rejects.toThrow(/^Nothing was captured\./);
  });

  it('gives the same message when the helper exits non-zero with nothing written', async () => {
    spawnHelper({ frames: false, exitCode: 1 });
    await recordFor59s();

    await expect(stopRecording()).rejects.toThrow(/^Nothing was captured\./);
  });
});
