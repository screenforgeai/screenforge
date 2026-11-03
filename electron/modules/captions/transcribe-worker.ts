import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WaveFile } from 'wavefile';
import type { CaptionSegment, CaptionWord } from '../../../src/types/index';

const execFileAsync = promisify(execFile);

interface WorkerInput {
  videoPath: string;
  modelId: string;
  language: string;
  modelCacheDir: string;
  ffmpegPath: string;
}

type ProgressInfo = {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
};

async function extractAudioToWav(
  ffmpegPath: string,
  videoPath: string,
  outputPath: string,
): Promise<void> {
  await execFileAsync(ffmpegPath, [
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    outputPath,
  ]);
}

function wavToFloat32(buffer: Buffer): Float32Array {
  const wav = new WaveFile(buffer);
  wav.toBitDepth('32f');
  const samples = wav.getSamples(false, Float32Array) as Float32Array | Float32Array[];
  if (Array.isArray(samples)) {
    if (samples.length > 1) {
      const SCALING_FACTOR = Math.sqrt(2);
      const mono = new Float32Array(samples[0].length);
      for (let i = 0; i < mono.length; i++) {
        mono[i] = (SCALING_FACTOR * (samples[0][i] + samples[1][i])) / 2;
      }
      return mono;
    }
    return samples[0];
  }
  return samples;
}

function groupWordsIntoSegments(
  words: Array<{ text: string; timestamp: [number, number | null] }>,
): CaptionSegment[] {
  const segments: CaptionSegment[] = [];
  let currentWords: CaptionWord[] = [];
  let segmentStart = 0;

  for (let i = 0; i < words.length; i++) {
    const chunk = words[i];
    const wordText = chunk.text.trim();
    if (!wordText) {
      continue;
    }

    const start = chunk.timestamp[0];
    const end = chunk.timestamp[1] ?? start + 0.5;

    if (currentWords.length === 0) {
      segmentStart = start;
    }

    currentWords.push({ word: wordText, start, end });

    const nextChunk = words[i + 1];
    const gapToNext = nextChunk ? nextChunk.timestamp[0] - end : 0;
    const segmentDuration = end - segmentStart;
    const isEndOfSentence = /[.!?]$/.test(wordText);
    const tooLong = segmentDuration > 7 || currentWords.length >= 12;
    const isLast = i === words.length - 1;

    if (isEndOfSentence || gapToNext > 1.0 || tooLong || isLast) {
      segments.push({
        id: `seg-${Date.now()}-${segments.length}`,
        start: segmentStart,
        end,
        text: currentWords.map((w) => w.word).join(' '),
        words: [...currentWords],
      });
      currentWords = [];
    }
  }

  return segments;
}

function send(msg: Record<string, unknown>): void {
  process.parentPort.postMessage(msg);
}

process.parentPort.on('message', async (event: Electron.MessageEvent) => {
  const { videoPath, modelId, language, modelCacheDir, ffmpegPath } = event.data as WorkerInput;

  const tmpWav = path.join(os.tmpdir(), `sf-captions-${Date.now()}.wav`);

  try {
    await extractAudioToWav(ffmpegPath, videoPath, tmpWav);

    // Dynamic import so this is not hoisted to the top of the CJS output —
    // onnxruntime-node (inside transformers) is loaded only when a job arrives.
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = modelCacheDir;

    const fileProgress = new Map<string, { loaded: number; total: number }>();

    const transcriber = await pipeline('automatic-speech-recognition', modelId, {
      dtype: 'q8',
      progress_callback: (info: ProgressInfo) => {
        const { status, file, loaded, total } = info;
        if (status === 'initiate' && file) {
          fileProgress.set(file, { loaded: 0, total: 0 });
        } else if (status === 'progress' && file && loaded != null && total != null) {
          fileProgress.set(file, { loaded, total });
          let totalLoaded = 0;
          let totalSize = 0;
          for (const entry of fileProgress.values()) {
            totalLoaded += entry.loaded;
            totalSize += entry.total;
          }
          if (totalSize > 0) {
            send({ type: 'progress', stage: 'model-load', progress: totalLoaded / totalSize });
          }
        }
      },
    });

    const audioData = wavToFloat32(await fs.readFile(tmpWav));

    send({ type: 'progress', stage: 'transcribing', progress: 0 });

    const result = await (
      transcriber as (
        input: Float32Array,
        options: Record<string, unknown>,
      ) => Promise<{
        chunks?: Array<{ text: string; timestamp: [number, number | null] }>;
      }>
    )(audioData, {
      return_timestamps: 'word',
      language,
      chunk_length_s: 30,
      stride_length_s: 5,
      task: 'transcribe',
    });

    const segments = groupWordsIntoSegments(result.chunks ?? []);
    send({ type: 'result', segments });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: 'error', message });
  } finally {
    void fs.unlink(tmpWav);
    process.exit(0);
  }
});
