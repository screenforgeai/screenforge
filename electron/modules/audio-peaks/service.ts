import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import log from '../../lib/logger';
import { getFFmpegPath } from '../ffmpeg';
import type { AudioPeaks } from '../../../src/types/index';

export type { AudioPeaks };

/**
 * Waveform peaks for the timeline's audio lane. ffmpeg decodes the audio in a
 * child process and streams it here, where it is reduced to peaks as it
 * arrives: the editor never holds the source file or its decoded PCM, which
 * for an hour-long recording are several GB.
 */

/** Decode rate: high enough that short sounds still register in the peaks. */
export const PEAK_SAMPLE_RATE = 8_000;
/** Peak resolution: one bar per 20 ms, so even a short clip of a long recording has detail. */
export const AUDIO_PEAKS_PER_SECOND = 50;

export type PeakAccumulator = {
  /** Takes raw little-endian float32 samples; a sample may be split across chunks. */
  push: (chunk: Buffer) => void;
  finish: () => { peaks: number[]; sampleCount: number };
};

export function createPeakAccumulator(samplesPerPeak: number): PeakAccumulator {
  const peaks: number[] = [];
  let leftover: Buffer = Buffer.alloc(0);
  let current = 0;
  let inBucket = 0;
  let sampleCount = 0;

  return {
    push(chunk) {
      const data = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = data.length - (data.length % 4);
      for (let offset = 0; offset < usable; offset += 4) {
        const value = Math.abs(data.readFloatLE(offset));
        if (value > current) {
          current = value;
        }
        inBucket += 1;
        if (inBucket === samplesPerPeak) {
          peaks.push(current);
          current = 0;
          inBucket = 0;
        }
      }
      sampleCount += usable / 4;
      leftover = Buffer.from(data.subarray(usable));
    },
    finish() {
      if (inBucket > 0) {
        peaks.push(current);
        current = 0;
        inBucket = 0;
      }
      return { peaks, sampleCount };
    },
  };
}

async function decodePeaks(filePath: string): Promise<AudioPeaks | null> {
  const bin = await getFFmpegPath();
  const args = [
    '-hide_banner',
    '-nostdin',
    '-v',
    'error',
    '-i',
    filePath,
    '-map',
    '0:a:0',
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(PEAK_SAMPLE_RATE),
    '-f',
    'f32le',
    'pipe:1',
  ];

  return new Promise<AudioPeaks | null>((resolve) => {
    const accumulator = createPeakAccumulator(PEAK_SAMPLE_RATE / AUDIO_PEAKS_PER_SECOND);
    let stderr = '';
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    proc.stdout.on('data', (chunk: Buffer) => accumulator.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => {
      // Only the tail is ever logged.
      stderr = (stderr + chunk.toString()).slice(-2_000);
    });
    proc.on('error', (err) => {
      log.warn('[audio-peaks] ffmpeg failed to start', { filePath, err });
      resolve(null);
    });
    proc.on('close', (code) => {
      const { peaks, sampleCount } = accumulator.finish();
      if (code !== 0 || sampleCount === 0) {
        // Most often: the file has no audio track.
        log.info('[audio-peaks] no peaks', { filePath, code, stderr: stderr.trim() });
        resolve(null);
        return;
      }
      resolve({ peaks, duration: sampleCount / PEAK_SAMPLE_RATE });
    });
  });
}

const cache = new Map<string, Promise<AudioPeaks | null>>();

/** Peaks of the file's first audio track, or null when it has none. Cached while the file is unchanged. */
export async function getAudioPeaks(filePath: string): Promise<AudioPeaks | null> {
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats) {
    return null;
  }
  const key = `${filePath}\u0000${stats.size}\u0000${stats.mtimeMs}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = decodePeaks(filePath);
    cache.set(key, pending);
  }
  return pending;
}
