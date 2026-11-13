// @vitest-environment node

import { EventEmitter } from 'node:events';
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
      // Display-change listeners the recording registers while it runs.
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

vi.mock('../ffmpeg/index', () => ({
  getFFmpegPath: vi.fn().mockResolvedValue('/usr/bin/ffmpeg'),
}));

vi.mock('../ffmpeg/runner', () => ({
  runFFmpeg: ffmpegRunnerMock.runFFmpeg,
}));

vi.mock('../../lib/logger', () => ({
  default: loggerMock,
}));

// The capture helper's share: its pointer moves are fed in by hand.
const shareMock = vi.hoisted(() => ({
  moveListener: null as ((x: number, y: number) => void) | null,
  live: false,
  share: null as null | {
    screen: { x: number; y: number; width: number; height: number };
    video: { width: number; height: number; format: string };
  },
  pointer: null as { x: number; y: number } | null,
  start: vi.fn(),
  finish: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  end: vi.fn(),
}));

vi.mock('./wayland-capture', () => ({
  setWaylandShareMoveListener: (listener: ((x: number, y: number) => void) | null) => {
    shareMock.moveListener = listener;
  },
  hasWaylandShare: () => shareMock.live,
  getWaylandShare: () => shareMock.share,
  getWaylandSharePointer: () => shareMock.pointer,
  startWaylandShareRecording: shareMock.start,
  finishWaylandShareRecording: shareMock.finish,
  pauseWaylandShareRecording: shareMock.pause,
  resumeWaylandShareRecording: shareMock.resume,
  endWaylandShare: shareMock.end,
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

/**
 * Fake ffmpeg probe process: emits the given stderr, then closes with code 0.
 * Used by hasAudioStream / probeMediaDurationMs inside stopRecording().
 */
function fakeProbeProcess(stderrText: string) {
  const proc = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    kill: () => void;
  };
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
  '  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 60 fps',
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

async function loadService() {
  return import('./service');
}

describe('recording service on Linux', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    for (const key of SESSION_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    setPlatform('linux');

    childProcessMock.spawn.mockImplementation(() => fakeProbeProcess(PROBE_STDERR_3S_NO_AUDIO));
    ffmpegRunnerMock.runFFmpeg.mockReturnValue({ promise: Promise.resolve() });
  });

  afterEach(() => {
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

  describe('getCaptureBackend', () => {
    it('selects the Wayland portal backend in Wayland sessions', async () => {
      process.env.XDG_SESSION_TYPE = 'wayland';
      const { getCaptureBackend } = await loadService();
      expect(getCaptureBackend()).toBe('wayland-portal');
    });

    it('selects the FFmpeg backend in X11 sessions', async () => {
      process.env.XDG_SESSION_TYPE = 'x11';
      process.env.DISPLAY = ':0';
      const { getCaptureBackend } = await loadService();
      expect(getCaptureBackend()).toBe('ffmpeg-x11');
    });

    it('reports unsupported when no display session is detectable', async () => {
      const { getCaptureBackend } = await loadService();
      expect(getCaptureBackend()).toBe('unsupported');
    });
  });

  describe('Wayland renderer capture', () => {
    beforeEach(() => {
      process.env.XDG_SESSION_TYPE = 'wayland';
      process.env.DISPLAY = ':0'; // XWayland: DISPLAY is set but must be ignored
    });

    it('rejects start when the renderer did not initialize portal capture', async () => {
      const { startRecording, isRecordingBusy } = await loadService();

      await expect(startRecording('screen:wayland', null)).rejects.toThrow(
        /system screen-share dialog/,
      );
      expect(isRecordingBusy()).toBe(false);
    });

    it('runs the full start → stop cycle: transcodes the webm and adopts stream dimensions', async () => {
      const { startRecording, stopRecording, isRecordingBusy } = await loadService();

      await startRecording('screen:wayland', null, { rendererCapture: true });
      expect(isRecordingBusy()).toBe(true);
      // No capture process is spawned on Wayland — the renderer records.
      expect(ffmpegRunnerMock.runFFmpeg).not.toHaveBeenCalled();

      const result = await stopRecording({
        webmPath: '/tmp/portal-capture.webm',
        width: 1280,
        height: 720,
      });

      expect(isRecordingBusy()).toBe(false);
      // The webm was transcoded to H.264 MP4 via FFmpeg.
      expect(ffmpegRunnerMock.runFFmpeg).toHaveBeenCalledTimes(1);
      const transcodeArgs = ffmpegRunnerMock.runFFmpeg.mock.calls[0][0] as string[];
      expect(transcodeArgs).toContain('/tmp/portal-capture.webm');
      expect(transcodeArgs).toContain('libopenh264');
      expect(transcodeArgs).toContain('+faststart');
      expect(transcodeArgs).toContain('-an');

      expect(result.filePath).toMatch(/screenforge-wayland-.*\.mp4$/);
      // The portal stream's pixel size is the authoritative capture area.
      expect(result.recordingArea).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
      // Duration comes from the probed media file (3s fake probe).
      expect(result.durationMs).toBe(3000);
      expect(result.hasEmbeddedAudio).toBe(false);
      expect(result.events).toEqual([]);
    });

    describe('screen picked through the capture helper', () => {
      const wide = { x: 1080, y: 272, width: 2560, height: 1440 };

      beforeEach(() => {
        shareMock.live = true;
        shareMock.share = { screen: wide, video: { width: 2560, height: 1440, format: 'bgr0' } };
        shareMock.start.mockResolvedValue({ fps: 60 });
        shareMock.finish.mockResolvedValue({ ok: true, frames: 180, late: 0 });
      });

      afterEach(() => {
        shareMock.live = false;
        shareMock.share = null;
        shareMock.pointer = null;
      });

      it('starts from where the pointer was, even if it never moves', async () => {
        shareMock.pointer = { x: 2000, y: 500 };
        const { startRecording, stopRecording } = await loadService();

        await startRecording('screen:wayland', null);
        const result = await stopRecording();

        expect(result.events).toEqual([expect.objectContaining({ type: 'move', x: 2000, y: 500 })]);
      });

      it('records it through the helper, with the pointer moves made while recording', async () => {
        const { startRecording, stopRecording, isRecordingBusy } = await loadService();

        shareMock.moveListener?.(50, 50); // before recording: not kept
        await startRecording('screen:wayland', null);
        expect(isRecordingBusy()).toBe(true);
        const outPath = shareMock.start.mock.calls[0][1] as string;
        expect(shareMock.start).toHaveBeenCalledWith('/usr/bin/ffmpeg', outPath);
        expect(outPath).toMatch(/screenforge-wayland-.*\.mp4$/);
        shareMock.moveListener?.(1500, 600);

        const result = await stopRecording();

        expect(isRecordingBusy()).toBe(false);
        expect(result.filePath).toBe(outPath);
        // Already H.264: no transcode.
        expect(ffmpegRunnerMock.runFFmpeg).not.toHaveBeenCalled();
        // The moves are in desktop coordinates, the picked screen's own space.
        expect(result.recordingArea).toEqual(wide);
        expect(result.events).toEqual([expect.objectContaining({ type: 'move', x: 1500, y: 600 })]);
        expect(shareMock.end).toHaveBeenCalled();
      });

      it('fails the stop when the helper could not save the recording', async () => {
        shareMock.finish.mockResolvedValue({ ok: false, frames: 0, late: 0 });
        const { startRecording, stopRecording, isRecordingBusy } = await loadService();

        await startRecording('screen:wayland', null);
        await expect(stopRecording()).rejects.toThrow(/could not be saved/);
        expect(isRecordingBusy()).toBe(false);
      });

      it('passes pause and resume on to the helper', async () => {
        const { startRecording, pauseRecording, resumeRecording } = await loadService();

        await startRecording('screen:wayland', null);
        pauseRecording();
        resumeRecording();

        expect(shareMock.pause).toHaveBeenCalledTimes(1);
        expect(shareMock.resume).toHaveBeenCalledTimes(1);
      });

      it('lets the share go when the recording is discarded', async () => {
        const { startRecording, discardRecording, isRecordingBusy } = await loadService();

        await startRecording('screen:wayland', null);
        await discardRecording();

        expect(shareMock.end).toHaveBeenCalled();
        expect(isRecordingBusy()).toBe(false);
      });

      it('crops an area drawn on a still of the picked screen', async () => {
        const { startRecording, stopRecording } = await loadService();
        const { probeExportSource } = await import('../export/service');
        vi.mocked(probeExportSource).mockResolvedValue({
          fps: 60,
          duration: 3,
          width: 2560,
          height: 1440,
        });
        const area = {
          x: 100,
          y: 50,
          width: 800,
          height: 600,
          frame: { width: 2560, height: 1440 },
        };

        await startRecording('screen:wayland', area);
        const result = await stopRecording();

        expect(result.areaCrop).toMatchObject({ sourceWidth: 2560, sourceHeight: 1440 });
      });
    });

    describe('area recording', () => {
      const area = { x: 100, y: 50, width: 801, height: 601 };

      async function stopWithStream(
        stream: { width?: number; height?: number },
        probed: { width: number | null; height: number | null },
      ) {
        const { startRecording, stopRecording } = await loadService();
        const { probeExportSource } = await import('../export/service');
        vi.mocked(probeExportSource).mockResolvedValue({ fps: 30, duration: 3, ...probed });
        await startRecording('screen:wayland', area, { rendererCapture: true });
        return stopRecording({ webmPath: '/tmp/portal-capture.webm', ...stream });
      }

      it('crops when the streamed monitor is the one the area was drawn on', async () => {
        const result = await stopWithStream(
          { width: 1920, height: 1080 },
          { width: 1920, height: 1080 },
        );
        expect(result.areaCrop).toEqual({
          x: 100,
          y: 50,
          width: 801,
          height: 601,
          sourceWidth: 1920,
          sourceHeight: 1080,
        });
      });

      it('opens uncropped when the picker streamed a same-shaped monitor of another size', async () => {
        // A 1280x720 monitor is 16:9 too: its shape alone can't tell them apart.
        const result = await stopWithStream(
          { width: 1280, height: 720 },
          { width: 1280, height: 720 },
        );
        expect(result.areaCrop).toBeUndefined();
      });

      it("uses the stream's size when the video can't be measured", async () => {
        const matching = await stopWithStream(
          { width: 1920, height: 1080 },
          { width: null, height: null },
        );
        expect(matching.areaCrop).toMatchObject({ sourceWidth: 1920, sourceHeight: 1080 });
      });

      describe('drawn on a still of the picked screen', () => {
        // The still is the stream's own picture, so any monitor can be picked.
        const onStill = {
          x: 100,
          y: 50,
          width: 400,
          height: 300,
          frame: { width: 2560, height: 1440 },
        };

        async function stopWithVideo(video: { width: number; height: number }) {
          const { startRecording, stopRecording } = await loadService();
          const { probeExportSource } = await import('../export/service');
          vi.mocked(probeExportSource).mockResolvedValue({ fps: 30, duration: 3, ...video });
          await startRecording('screen:wayland', onStill, { rendererCapture: true });
          return stopRecording({ webmPath: '/tmp/portal-capture.webm', ...video });
        }

        it('crops it in the video, whatever monitor was picked', async () => {
          const result = await stopWithVideo({ width: 2560, height: 1440 });
          expect(result.areaCrop).toEqual({
            x: 100,
            y: 50,
            width: 400,
            height: 300,
            sourceWidth: 2560,
            sourceHeight: 1440,
          });
        });

        it('scales it when the video came out smaller than the still', async () => {
          const result = await stopWithVideo({ width: 1280, height: 720 });
          expect(result.areaCrop).toEqual({
            x: 50,
            y: 25,
            width: 200,
            height: 150,
            sourceWidth: 1280,
            sourceHeight: 720,
          });
        });

        it('opens uncropped when the video is not the picture it was drawn on', async () => {
          const result = await stopWithVideo({ width: 1080, height: 1920 });
          expect(result.areaCrop).toBeUndefined();
        });
      });

      it('opens uncropped when neither the video nor the stream has a size', async () => {
        const result = await stopWithStream({}, { width: null, height: null });
        expect(result.areaCrop).toBeUndefined();
      });
    });

    it('rejects stop when the renderer produced no video data', async () => {
      const { startRecording, stopRecording, isRecordingBusy } = await loadService();

      await startRecording('screen:wayland', null, { rendererCapture: true });
      await expect(stopRecording()).rejects.toThrow(/did not produce any video data/);
      expect(isRecordingBusy()).toBe(false);
    });

    it('supports pause/resume bookkeeping without signaling any process', async () => {
      const { startRecording, pauseRecording, resumeRecording, stopRecording } =
        await loadService();

      await startRecording('screen:wayland', null, { rendererCapture: true });
      pauseRecording();
      resumeRecording();
      const result = await stopRecording({ webmPath: '/tmp/p.webm', width: 640, height: 480 });

      expect(result.durationMs).toBe(3000);
    });

    it('discards an active renderer capture without spawning anything', async () => {
      const { startRecording, discardRecording, isRecordingBusy } = await loadService();

      await startRecording('screen:wayland', null, { rendererCapture: true });
      await expect(discardRecording()).resolves.toBeUndefined();
      expect(isRecordingBusy()).toBe(false);
      expect(ffmpegRunnerMock.runFFmpeg).not.toHaveBeenCalled();
    });
  });

  describe('unknown Linux session', () => {
    it('fails start with a clear error instead of grabbing a black screen', async () => {
      const { startRecording } = await loadService();

      await expect(startRecording('screen:0', null)).rejects.toThrow(
        /Could not detect a supported display session/,
      );
    });
  });
});
