/**
 * Low-level FFmpeg runner.
 * Spawns the FFmpeg process, streams progress, and returns a cancellable promise.
 */
import { spawn } from 'node:child_process';
import log from '../../lib/logger';
import { getFFmpegPath } from './index';

export interface FFmpegProgress {
  /** Seconds of video processed so far */
  time: number;
  /** Total duration in seconds — undefined until known */
  duration?: number;
  /** 0–1 fraction, undefined if duration not yet known */
  percent?: number;
}

export interface FFmpegJob {
  /** Resolves with output path on success */
  promise: Promise<string>;
  /** Terminates the process early */
  cancel: () => void;
  /** Returns current child-process pid when running */
  getPid: () => number | null;
}

/**
 * Runs FFmpeg with the given args.
 *
 * @param args     Full argument list (everything after the binary name)
 * @param output   Expected output file path — returned on success
 * @param onProgress  Optional progress callback
 */
export function runFFmpeg(
  args: string[],
  output: string,
  onProgress?: (p: FFmpegProgress) => void,
): FFmpegJob {
  let cancelled = false;
  let proc: ReturnType<typeof spawn> | null = null;

  const promise = (async (): Promise<string> => {
    const bin = await getFFmpegPath();
    log.info('[ffmpeg:runner] spawn:', bin, args.join(' '));

    return new Promise<string>((resolve, reject) => {
      proc = spawn(bin, args);

      let duration: number | undefined;
      let stderr = '';

      proc.stderr?.on('data', (chunk: Buffer) => {
        const line = chunk.toString();
        stderr += line;

        // Parse total duration once
        if (!duration) {
          const m = line.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
          if (m) {
            duration = +m[1] * 3600 + +m[2] * 60 + +m[3];
          }
        }

        // Parse progress
        if (onProgress) {
          const m = line.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
          if (m) {
            const time = +m[1] * 3600 + +m[2] * 60 + +m[3];
            onProgress({
              time,
              duration,
              percent: duration ? time / duration : undefined,
            });
          }
        }
      });

      proc.on('close', (code) => {
        if (cancelled) {
          reject(new Error('FFmpeg job cancelled'));
          return;
        }
        if (code === 0) {
          resolve(output);
        } else {
          const tail = stderr.slice(-1200).trim();
          log.error('[ffmpeg:runner] exited with code', code, '\n', tail);
          reject(new Error(`FFmpeg exited with code ${code}: ${tail || 'no stderr output'}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      proc?.kill('SIGTERM');
    },
    getPid() {
      return proc?.pid ?? null;
    },
  };
}
