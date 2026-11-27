// @vitest-environment node

// The timeline waveform used to fetch the whole audio source into the editor
// and decode it to PCM. With the mic merged in, that source is the recording:
// for an hour that is a multi-GB fetch plus ~1.4 GB of decoded floats, enough
// to crash the editor. ffmpeg now decodes it in a child process and only the
// peaks come back.

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: childProcessMock.spawn }));
vi.mock('../ffmpeg', () => ({ getFFmpegPath: vi.fn(async () => '/bin/ffmpeg') }));
vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const statMock = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({ default: { stat: statMock } }));

import {
  AUDIO_PEAKS_PER_SECOND,
  PEAK_SAMPLE_RATE,
  createPeakAccumulator,
  getAudioPeaks,
} from './service';

const floats = (values: number[]) => Buffer.from(new Float32Array(values).buffer);

/** A fake ffmpeg that writes the given samples (f32le) and exits with `code`. */
function fakeFFmpeg(samples: number[], code = 0) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn();
  setImmediate(() => {
    proc.stdout.end(floats(samples));
    proc.stdout.on('end', () => setImmediate(() => proc.emit('close', code)));
    proc.stdout.resume();
  });
  return proc;
}

beforeEach(() => {
  childProcessMock.spawn.mockReset();
  statMock.mockReset();
  statMock.mockResolvedValue({ size: 1000, mtimeMs: 1 });
});

describe('createPeakAccumulator', () => {
  it('keeps the loudest absolute sample of each bucket', () => {
    const acc = createPeakAccumulator(3);
    acc.push(floats([0.1, -0.5, 0.2, 0.3, 0.1, -0.05]));

    const { peaks, sampleCount } = acc.finish();
    expect(peaks).toHaveLength(2);
    expect(peaks[0]).toBeCloseTo(0.5);
    expect(peaks[1]).toBeCloseTo(0.3);
    expect(sampleCount).toBe(6);
  });

  it('joins samples split across chunk boundaries', () => {
    const acc = createPeakAccumulator(2);
    const bytes = floats([0.25, -0.75, 0.5]);
    acc.push(bytes.subarray(0, 3));
    acc.push(bytes.subarray(3, 9));
    acc.push(bytes.subarray(9));

    const { peaks, sampleCount } = acc.finish();
    expect(sampleCount).toBe(3);
    expect(peaks[0]).toBeCloseTo(0.75);
    // The last, partial bucket is kept.
    expect(peaks[1]).toBeCloseTo(0.5);
  });
});

describe('getAudioPeaks', () => {
  it('decodes the first audio track to low-rate mono and returns its peaks and length', async () => {
    const perPeak = PEAK_SAMPLE_RATE / AUDIO_PEAKS_PER_SECOND;
    const samples = Array.from({ length: perPeak * 3 }, (_, i) => (i === perPeak + 1 ? -0.9 : 0.1));
    childProcessMock.spawn.mockReturnValue(fakeFFmpeg(samples));

    const result = await getAudioPeaks('/rec/long-take.mp4');

    expect(result?.duration).toBeCloseTo(3 / AUDIO_PEAKS_PER_SECOND);
    expect(result?.peaks).toHaveLength(3);
    expect(result?.peaks[1]).toBeCloseTo(0.9);
    const [bin, args] = childProcessMock.spawn.mock.calls[0];
    expect(bin).toBe('/bin/ffmpeg');
    expect(args).toEqual(
      expect.arrayContaining(['-i', '/rec/long-take.mp4', '-map', '0:a:0', '-vn', '-f', 'f32le']),
    );
    expect(args.join(' ')).toContain(`-ac 1 -ar ${PEAK_SAMPLE_RATE}`);
  });

  it('returns null when the file has no audio track', async () => {
    childProcessMock.spawn.mockReturnValue(fakeFFmpeg([], 1));

    await expect(getAudioPeaks('/rec/silent.mp4')).resolves.toBeNull();
  });

  it('decodes a file once while it is unchanged', async () => {
    childProcessMock.spawn.mockImplementation(() => fakeFFmpeg([0.5, 0.5]));

    await getAudioPeaks('/rec/cached.mp4');
    await getAudioPeaks('/rec/cached.mp4');
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);

    statMock.mockResolvedValue({ size: 2000, mtimeMs: 2 });
    await getAudioPeaks('/rec/cached.mp4');
    expect(childProcessMock.spawn).toHaveBeenCalledTimes(2);
  });

  it('returns null for a file that does not exist', async () => {
    statMock.mockRejectedValue(new Error('ENOENT'));

    await expect(getAudioPeaks('/rec/missing.mp4')).resolves.toBeNull();
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });
});
