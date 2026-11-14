// @vitest-environment node

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const primaryDisplay = {
    id: 0,
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    scaleFactor: 1,
  };
  return {
    primaryDisplay,
    app: {
      isPackaged: false,
      getAppPath: () => '/dev/project',
      getPath: () => '/tmp',
    },
    screen: {
      getAllDisplays: () => [primaryDisplay],
      getPrimaryDisplay: () => primaryDisplay,
      on: () => undefined,
      removeListener: () => undefined,
    },
  };
});

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

const ffmpegRunnerMock = vi.hoisted(() => ({
  runFFmpeg: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('electron', () => ({
  app: electronMock.app,
  screen: electronMock.screen,
}));

vi.mock('node:child_process', () => ({
  spawn: childProcessMock.spawn,
  execFile: childProcessMock.execFile,
}));

vi.mock('uiohook-napi', () => ({
  uIOhook: {
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

vi.mock('../ffmpeg/index', () => ({
  getFFmpegPath: vi.fn().mockResolvedValue('/usr/bin/ffmpeg'),
}));

vi.mock('../ffmpeg/runner', () => ({
  runFFmpeg: ffmpegRunnerMock.runFFmpeg,
}));

vi.mock('../../lib/logger', () => ({
  default: loggerMock,
}));

vi.mock('../../lib/telemetry', () => ({
  trackMemorySnapshot: vi.fn(),
}));

vi.mock('../../lib/macos-native-capture', () => ({
  shouldUseMacNativeCapture: vi.fn(() => false),
  shouldUseNativeCapture: vi.fn(() => false),
}));

vi.mock('../app/service', () => ({
  prepareRecordingStartPermissionsIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../sources/service', () => ({
  getMacWindowMetadata: vi.fn().mockResolvedValue(new Map()),
  parseWindowIdFromSourceId: vi.fn(() => null),
}));

vi.mock('../export/service', () => ({
  probeExportSource: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
}));

type FakeCaptureProc = EventEmitter & {
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  args: string[];
  stderr: EventEmitter;
  stdout: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
};

let captureProcs: FakeCaptureProc[] = [];

/**
 * Fake x11grab FFmpeg: announces its output like the real one, and exits
 * cleanly when it receives the `q` quit command on stdin.
 */
function fakeCaptureProcess(args: string[]): FakeCaptureProc {
  const proc = new EventEmitter() as FakeCaptureProc;
  proc.pid = 40000 + captureProcs.length;
  proc.exitCode = null;
  proc.signalCode = null;
  proc.args = args;
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.kill = vi.fn();
  proc.stdin = {
    write: vi.fn((data: string) => {
      if (data.startsWith('q')) {
        process.nextTick(() => {
          proc.exitCode = 0;
          proc.emit('close', 0, null);
        });
      }
      return true;
    }),
    end: vi.fn(),
  };
  process.nextTick(() => {
    proc.stderr.emit('data', Buffer.from("Output #0, mp4, to 'out.mp4':\n"));
  });
  captureProcs.push(proc);
  return proc;
}

/** Fake ffmpeg probe (duration / audio checks inside stopRecording). */
function fakeProbeProcess(stderrText: string) {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  process.nextTick(() => {
    proc.stderr.emit('data', Buffer.from(stderrText));
    proc.emit('close', 0);
  });
  return proc;
}

const PROBE_STDERR_3S_NO_AUDIO = [
  'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from output.mp4:',
  '  Duration: 00:00:03.00, start: 0.000000, bitrate: 20000 kb/s',
  '  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 60 fps',
].join('\n');

const originalPlatform = process.platform;
const savedEnv: Record<string, string | undefined> = {};
const SESSION_ENV_KEYS = ['XDG_SESSION_TYPE', 'WAYLAND_DISPLAY', 'DISPLAY'];

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
}

function outputPathOf(proc: FakeCaptureProc): string {
  return proc.args[proc.args.length - 1];
}

async function loadService() {
  return import('./service');
}

describe('recording service: X11 pause/resume', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;
  let concatLists: string[];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of SESSION_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    setPlatform('linux');
    process.env.XDG_SESSION_TYPE = 'x11';
    process.env.DISPLAY = ':0';

    captureProcs = [];
    concatLists = [];
    childProcessMock.spawn.mockImplementation((_bin: string, args: string[]) =>
      args.includes('x11grab')
        ? fakeCaptureProcess(args)
        : fakeProbeProcess(PROBE_STDERR_3S_NO_AUDIO),
    );
    ffmpegRunnerMock.runFFmpeg.mockImplementation((args: string[], output: string) => ({
      promise: (async () => {
        const listIndex = args.indexOf('-i');
        if (args.includes('concat') && listIndex >= 0) {
          concatLists.push(await fs.readFile(args[listIndex + 1], 'utf8'));
        }
        return output;
      })(),
    }));
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
    for (const key of SESSION_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  afterAll(() => {
    setPlatform(originalPlatform);
  });

  it('finalizes the running segment on pause instead of freezing FFmpeg', async () => {
    const { startRecording, pauseRecording, isRecordingBusy, discardRecording } =
      await loadService();

    await startRecording('screen:0', null);
    pauseRecording();

    await vi.waitFor(() => expect(captureProcs[0].exitCode).toBe(0));
    expect(captureProcs[0].stdin.write).toHaveBeenCalledWith('q\n');
    // SIGSTOP leaves x11grab's wall-clock timestamps running, which keeps the
    // paused time in the video while cursor events drop it.
    expect(killSpy).not.toHaveBeenCalledWith(expect.any(Number), 'SIGSTOP');
    // Still a recording in progress while paused.
    expect(isRecordingBusy()).toBe(true);

    await discardRecording();
  });

  it('starts a new segment with its own output file on resume', async () => {
    const { startRecording, pauseRecording, resumeRecording, discardRecording } =
      await loadService();

    await startRecording('screen:0', null);
    pauseRecording();
    resumeRecording();

    await vi.waitFor(() => expect(captureProcs).toHaveLength(2));
    expect(captureProcs[1].args).toEqual(
      captureProcs[0].args.map((arg) =>
        arg === outputPathOf(captureProcs[0]) ? expect.any(String) : arg,
      ),
    );
    expect(outputPathOf(captureProcs[1])).not.toBe(outputPathOf(captureProcs[0]));

    await discardRecording();
  });

  it('joins the segments losslessly, in order, on stop', async () => {
    const { startRecording, pauseRecording, resumeRecording, stopRecording, isRecordingBusy } =
      await loadService();

    await startRecording('screen:0', null);
    pauseRecording();
    resumeRecording();
    const result = await stopRecording();

    expect(captureProcs).toHaveLength(2);
    expect(captureProcs[1].exitCode).toBe(0);
    expect(ffmpegRunnerMock.runFFmpeg).toHaveBeenCalledTimes(1);
    const concatArgs = ffmpegRunnerMock.runFFmpeg.mock.calls[0][0] as string[];
    expect(concatArgs).toEqual(expect.arrayContaining(['-f', 'concat', '-c', 'copy']));
    expect(concatLists).toHaveLength(1);
    expect(concatLists[0]).toMatch(
      new RegExp(
        `^file '${outputPathOf(captureProcs[0])}'\\noutpoint \\d+\\.\\d{6}\\nfile '${outputPathOf(captureProcs[1])}'\\n$`,
      ),
    );
    expect(result.filePath).toBe(concatArgs[concatArgs.length - 1]);
    expect(result.filePath).toMatch(/screenforge-joined-.*\.mp4$/);
    expect(isRecordingBusy()).toBe(false);
  });

  it("cuts each paused segment at the pause (on a frame boundary), dropping FFmpeg's shutdown tail", async () => {
    let now = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { startRecording, pauseRecording, resumeRecording, stopRecording } = await loadService();

    await startRecording('screen:0', null); // segment 1 capturing at t=0
    now += 2510;
    pauseRecording(); // pressed 2.51s in; FFmpeg keeps grabbing until it quits
    now += 400;
    await vi.waitFor(() => expect(captureProcs[0].exitCode).toBe(0));
    now += 1000;
    resumeRecording();
    await vi.waitFor(() => expect(captureProcs).toHaveLength(2));
    now += 2000;
    await stopRecording();
    nowSpy.mockRestore();

    expect(concatLists[0]).toBe(
      // 2.51s snaps down to frame 150 at 60fps, so the cut never leaves a
      // sliver frame at the join.
      `file '${outputPathOf(captureProcs[0])}'\noutpoint 2.500000\nfile '${outputPathOf(captureProcs[1])}'\n`,
    );
  });

  it('stops cleanly while paused, with no FFmpeg running', async () => {
    const { startRecording, pauseRecording, stopRecording, isRecordingBusy } = await loadService();

    await startRecording('screen:0', null);
    pauseRecording();
    const result = await stopRecording();

    // One segment only: nothing to join, and no second capture was started.
    expect(captureProcs).toHaveLength(1);
    expect(ffmpegRunnerMock.runFFmpeg).not.toHaveBeenCalled();
    expect(result.filePath).toBe(outputPathOf(captureProcs[0]));
    expect(isRecordingBusy()).toBe(false);
  });

  it('keeps the single capture file when the recording was never paused', async () => {
    const { startRecording, stopRecording } = await loadService();

    await startRecording('screen:0', null);
    const result = await stopRecording();

    expect(captureProcs).toHaveLength(1);
    expect(ffmpegRunnerMock.runFFmpeg).not.toHaveBeenCalled();
    expect(result.filePath).toBe(outputPathOf(captureProcs[0]));
  });

  it('discards every segment of a paused recording', async () => {
    const { startRecording, pauseRecording, resumeRecording, discardRecording, isRecordingBusy } =
      await loadService();
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    await startRecording('screen:0', null);
    pauseRecording();
    resumeRecording();
    await discardRecording();

    const removed = unlinkSpy.mock.calls.map(([target]) => String(target));
    expect(removed).toEqual(
      expect.arrayContaining([outputPathOf(captureProcs[0]), outputPathOf(captureProcs[1])]),
    );
    expect(ffmpegRunnerMock.runFFmpeg).not.toHaveBeenCalled();
    expect(isRecordingBusy()).toBe(false);
    unlinkSpy.mockRestore();
  });
});
