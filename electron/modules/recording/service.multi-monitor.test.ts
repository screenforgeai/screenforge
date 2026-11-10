// @vitest-environment node

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeDisplay = {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
};

const electronMock = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;
  const listeners = new Map<string, Set<Listener>>();
  const state = {
    displays: [] as FakeDisplay[],
    primary: null as FakeDisplay | null,
  };
  const screen = {
    getAllDisplays: () => state.displays,
    getPrimaryDisplay: () => state.primary ?? state.displays[0],
    getDisplayNearestPoint: () => state.primary ?? state.displays[0],
    on: (event: string, listener: Listener) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)?.add(listener);
      return screen;
    },
    removeListener: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener);
      return screen;
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener({}, ...args);
      }
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    reset: () => listeners.clear(),
  };
  return {
    state,
    app: {
      isPackaged: false,
      getAppPath: () => '/dev/project',
      getPath: () => '/tmp',
    },
    screen,
  };
});

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

const ffmpegRunnerMock = vi.hoisted(() => ({
  runFFmpeg: vi.fn(),
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
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

/** Fake x11grab FFmpeg: announces its output and exits cleanly on `q`. */
function fakeCaptureProcess(args: string[]): FakeCaptureProc {
  const proc = new EventEmitter() as FakeCaptureProc;
  proc.pid = 50000 + captureProcs.length;
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

function fakeProbeProcess() {
  const proc = new EventEmitter() as EventEmitter & { stderr: EventEmitter; kill: () => void };
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  process.nextTick(() => {
    proc.stderr.emit(
      'data',
      Buffer.from(
        '  Duration: 00:00:03.00, start: 0.000000, bitrate: 20000 kb/s\n' +
          '  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 60 fps\n',
      ),
    );
    proc.emit('close', 0);
  });
  return proc;
}

// A 100% monitor on the left that the OS lists first, and the primary (where
// the area selector opens) to its right.
const leftMonitor: FakeDisplay = {
  id: 11,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
};
const primaryMonitor: FakeDisplay = {
  id: 22,
  bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
  scaleFactor: 2,
};

const originalPlatform = process.platform;
const SESSION_ENV_KEYS = ['XDG_SESSION_TYPE', 'WAYLAND_DISPLAY', 'DISPLAY'];
const savedEnv: Record<string, string | undefined> = {};

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
}

function argAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

describe('recording service: multiple monitors', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    electronMock.screen.reset();
    electronMock.state.displays = [leftMonitor, primaryMonitor];
    electronMock.state.primary = primaryMonitor;
    for (const key of SESSION_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    setPlatform('linux');
    process.env.XDG_SESSION_TYPE = 'x11';
    process.env.DISPLAY = ':0';

    captureProcs = [];
    childProcessMock.spawn.mockImplementation((_bin: string, args: string[]) =>
      args.includes('x11grab') ? fakeCaptureProcess(args) : fakeProbeProcess(),
    );
    ffmpegRunnerMock.runFFmpeg.mockImplementation((_args: string[], output: string) => ({
      promise: Promise.resolve(output),
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

  describe('area recording', () => {
    const area = { x: 100, y: 50, width: 800, height: 600 };

    it('captures the primary display the area was drawn on, not the first screen source', async () => {
      const { startRecording, discardRecording } = await import('./service');

      // The toolbar passes the first screen source, which here is the left monitor.
      await startRecording('screen:0', area);

      const args = captureProcs[0].args;
      expect(argAfter(args, '-video_size')).toBe('2560x1440');
      expect(argAfter(args, '-i')).toBe(':0+1920,0');

      await discardRecording();
    });

    it('records the display the area was selected on, even if the primary changed since', async () => {
      const { startRecording, discardRecording } = await import('./service');

      // Selected on the right monitor; the left one became primary before Record.
      electronMock.state.primary = leftMonitor;
      await startRecording('screen:0', { ...area, displayId: primaryMonitor.id });

      const args = captureProcs[0].args;
      expect(argAfter(args, '-video_size')).toBe('2560x1440');
      expect(argAfter(args, '-i')).toBe(':0+1920,0');

      await discardRecording();
    });

    it('refuses to record when the display the area was selected on is gone', async () => {
      const { startRecording } = await import('./service');

      electronMock.state.displays = [leftMonitor];
      electronMock.state.primary = leftMonitor;
      await expect(
        startRecording('screen:0', { ...area, displayId: primaryMonitor.id }),
      ).rejects.toThrow(/no longer connected/i);
      expect(captureProcs).toHaveLength(0);
    });

    it('reports the area in global coordinates, matching the cursor events', async () => {
      const { startRecording, stopRecording } = await import('./service');

      await startRecording('screen:0', area);
      const result = await stopRecording();

      expect(result.recordingArea).toEqual({ x: 2020, y: 50, width: 800, height: 600 });
    });

    it("crops with the recorded display's scale even if the primary changed mid-recording", async () => {
      const { startRecording, stopRecording } = await import('./service');

      await startRecording('screen:0', area);
      // e.g. the primary monitor was unplugged and the OS promoted the other one.
      electronMock.state.primary = leftMonitor;
      await stopRecording();

      const cropArgs = ffmpegRunnerMock.runFFmpeg.mock.calls
        .map(([args]) => args as string[])
        .find((args) => argAfter(args, '-vf')?.startsWith('crop='));
      expect(argAfter(cropArgs ?? [], '-vf')).toBe('crop=1600:1200:200:100');
    });
  });

  describe('display removed mid-recording', () => {
    it('reports the source as lost when the recorded display goes away', async () => {
      const { startRecording, onRecordingSourceLost, discardRecording } = await import('./service');
      const lost = vi.fn();
      onRecordingSourceLost(lost);

      await startRecording('screen:0', null); // the left monitor
      electronMock.screen.emit('display-removed', primaryMonitor);
      expect(lost).not.toHaveBeenCalled();

      electronMock.screen.emit('display-removed', leftMonitor);
      expect(lost).toHaveBeenCalledTimes(1);
      expect(lost).toHaveBeenCalledWith({ reason: 'display-removed' });

      await discardRecording();
    });

    it('stops listening for display changes once the recording ends', async () => {
      const { startRecording, stopRecording, onRecordingSourceLost } = await import('./service');
      const lost = vi.fn();
      onRecordingSourceLost(lost);

      await startRecording('screen:0', null);
      expect(electronMock.screen.listenerCount('display-removed')).toBe(1);
      await stopRecording();

      expect(electronMock.screen.listenerCount('display-removed')).toBe(0);
      expect(electronMock.screen.listenerCount('display-added')).toBe(0);
      expect(electronMock.screen.listenerCount('display-metrics-changed')).toBe(0);
      electronMock.screen.emit('display-removed', leftMonitor);
      expect(lost).not.toHaveBeenCalled();
    });

    it('still stops cleanly after the capture process died with the display', async () => {
      const { startRecording, stopRecording } = await import('./service');

      await startRecording('screen:0', null);
      // x11grab errors out when its region leaves the screen, after having
      // written what it captured so far.
      const proc = captureProcs[0];
      const outPath = proc.args[proc.args.length - 1];
      await fs.writeFile(outPath, 'partial capture');
      proc.exitCode = 1;
      proc.emit('close', 1, null);
      electronMock.screen.emit('display-removed', leftMonitor);

      const result = await stopRecording();
      expect(result.filePath).toBe(outPath);
      await fs.unlink(outPath).catch(() => undefined);
    });
  });
});
