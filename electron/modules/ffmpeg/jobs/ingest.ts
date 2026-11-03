/**
 * Ingest job — runs automatically after recording stops.
 *
 * Responsibilities:
 *   1. Remove the system cursor from the raw .webm via delogo
 *   2. (Future) noise reduction, silence trimming, etc.
 *
 * Input:  raw .webm saved by saveRecording()
 * Output: cleaned .webm at the same temp path (replaces in-place via swap)
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import log from '../../../lib/logger';
import { runFFmpeg } from '../runner';
import { buildDelogoFilter } from '../filters/delogo';
import type {
  CursorEvent,
  RecordingArea,
  RecordingBoundsSample,
} from '../../../../src/types/index';

export interface IngestOptions {
  /** Path to raw recorded .webm */
  inputPath: string;
  /** Video dimensions — obtained from the recording source */
  videoWidth: number;
  videoHeight: number;
  /** Mouse events from uiohook */
  cursorEvents: CursorEvent[];
  /** Date.now() ms at recording start */
  startTime: number;
  /** Logical-pixel bounds of captured display */
  recordingArea: RecordingArea;
  captureBoundsTimeline?: RecordingBoundsSample[];
}

/**
 * Processes the raw recording, removes cursor, returns the output file path.
 * If cursor removal is not applicable (no events, ffmpeg error), returns
 * the original path so the caller always gets a usable file.
 */
export async function runIngestJob(opts: IngestOptions): Promise<string> {
  const {
    inputPath,
    videoWidth,
    videoHeight,
    cursorEvents,
    startTime,
    recordingArea,
    captureBoundsTimeline,
  } = opts;

  const filter = buildDelogoFilter({
    events: cursorEvents,
    startTime,
    recordingArea,
    boundsTimeline: captureBoundsTimeline,
    videoWidth,
    videoHeight,
  });

  if (!filter) {
    log.info('[ingest] no cursor events — skipping delogo, returning raw file');
    return inputPath;
  }

  const outPath = path.join(app.getPath('temp'), `screenforge-ingest-${randomUUID()}.webm`);

  log.info('[ingest] running delogo on', inputPath, '→', outPath);
  log.info('[ingest] filter segments:', filter.split(',').length);

  const args = [
    '-y',
    '-i',
    inputPath,
    '-vf',
    filter,
    '-c:v',
    'libvpx-vp9',
    '-lossless',
    '1',
    '-deadline',
    'good',
    '-cpu-used',
    '2',
    '-c:a',
    'copy',
    outPath,
  ];

  try {
    const job = runFFmpeg(args, outPath, (p) => {
      if (p.percent != null) {
        log.info(`[ingest] progress: ${(p.percent * 100).toFixed(1)}%`);
      }
    });

    await job.promise;

    // Swap: remove original raw file, rename ingested file to original path
    await fs.unlink(inputPath);
    await fs.rename(outPath, inputPath);

    log.info('[ingest] done, cursor removed');
    return inputPath;
  } catch (err) {
    log.error('[ingest] delogo failed, falling back to raw file:', err);
    // Clean up temp output if it exists
    await fs.unlink(outPath).catch(() => undefined);
    return inputPath;
  }
}
