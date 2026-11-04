// @vitest-environment node

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ffmpegRunnerMock = vi.hoisted(() => ({
  runFFmpeg: vi.fn(),
}));

const exportServiceMock = vi.hoisted(() => ({
  probeExportSource: vi.fn(),
}));

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/dev/project', getPath: () => '/tmp' },
  screen: {
    getAllDisplays: () => [],
    getPrimaryDisplay: () => ({ id: 0, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
}));

vi.mock('node:child_process', () => ({
  spawn: childProcessMock.spawn,
  execFile: childProcessMock.execFile,
}));

vi.mock('uiohook-napi', () => ({
  uIOhook: { on: vi.fn(), start: vi.fn(), stop: vi.fn(), removeAllListeners: vi.fn() },
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
  probeExportSource: exportServiceMock.probeExportSource,
}));

const { concatRecordings, cropRecording, reencodeRecording } = await import('./service');

/** The audio probe runs `ffmpeg -i`: report one audio stream. */
function fakeProbeWithAudio() {
  const proc = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
  queueMicrotask(() => {
    proc.stderr.emit('data', Buffer.from('Stream #0:1: Audio: aac'));
    proc.emit('close', 0);
  });
  return proc;
}

const lastFFmpegArgs = (): string[] => ffmpegRunnerMock.runFFmpeg.mock.calls.at(-1)?.[0] ?? [];
const argAfter = (args: string[], flag: string): string => args[args.indexOf(flag) + 1];

describe('post-processing encodes stay within H.264 frame limits', () => {
  beforeEach(() => {
    ffmpegRunnerMock.runFFmpeg.mockReturnValue({ promise: Promise.resolve() });
    childProcessMock.spawn.mockImplementation(fakeProbeWithAudio);
    vi.spyOn(fs, 'copyFile').mockResolvedValue(undefined);
    vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('joins a 5K recording with another clip at 4096x2304, scaling both', async () => {
    exportServiceMock.probeExportSource.mockResolvedValue({ width: 5120, height: 2880 });

    await concatRecordings('/first.mp4', '/second.mp4');

    const filter = argAfter(lastFFmpegArgs(), '-filter_complex');
    expect(filter).toContain('[0:v]scale=4096:2304:force_original_aspect_ratio=decrease');
    expect(filter).toContain('[1:v]scale=4096:2304:force_original_aspect_ratio=decrease');
    expect(filter).not.toContain('5120');
  });

  it('joins a 1080p recording at its own size, as before', async () => {
    exportServiceMock.probeExportSource.mockResolvedValue({ width: 1920, height: 1080 });

    await concatRecordings('/first.mp4', '/second.mp4');

    const filter = argAfter(lastFFmpegArgs(), '-filter_complex');
    expect(filter).toContain('[0:v]format=yuv420p,setsar=1[v0]');
    expect(filter).toContain('[1:v]scale=1920:1080:force_original_aspect_ratio=decrease');
  });

  it('re-encodes a 5K recording at 4096x2304', async () => {
    exportServiceMock.probeExportSource.mockResolvedValue({ width: 5120, height: 2880 });

    await reencodeRecording('/project.mp4');

    expect(argAfter(lastFFmpegArgs(), '-vf')).toContain('scale=4096:2304');
  });

  it('re-encodes a 1080p recording without scaling, as before', async () => {
    exportServiceMock.probeExportSource.mockResolvedValue({ width: 1920, height: 1080 });

    await reencodeRecording('/project.mp4');

    expect(argAfter(lastFFmpegArgs(), '-vf')).toBe('format=yuv420p,setsar=1');
  });

  it('scales a crop that is still larger than H.264 allows', async () => {
    await cropRecording('/rec.mp4', { x: 0, y: 0, width: 2560, height: 1440 }, 2);

    const vf = argAfter(lastFFmpegArgs(), '-vf');
    expect(vf).toContain('crop=5120:2880:0:0');
    expect(vf).toContain('scale=4096:2304');
  });

  it('crops a normal area without scaling, as before', async () => {
    await cropRecording('/rec.mp4', { x: 10, y: 20, width: 800, height: 600 }, 2);

    expect(argAfter(lastFFmpegArgs(), '-vf')).toBe('crop=1600:1200:20:40');
  });
});
