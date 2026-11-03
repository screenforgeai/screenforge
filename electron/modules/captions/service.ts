import path from 'node:path';
import fs from 'node:fs/promises';
import { app, dialog, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import log from '../../lib/logger';
import { getFFmpegPath } from '../ffmpeg/index';
import type { CaptionSegment, WhisperModel } from '../../../src/types/index';

const MODEL_IDS: Record<WhisperModel, string> = {
  tiny: 'Xenova/whisper-tiny',
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
  medium: 'Xenova/whisper-medium',
};

function getModelCacheDir(): string {
  return path.join(app.getPath('userData'), 'whisper-models');
}

let currentWorker: UtilityProcess | null = null;
let isCancelled = false;

export function cancelTranscription(): void {
  isCancelled = true;
  if (currentWorker) {
    currentWorker.kill();
    currentWorker = null;
  }
}

export async function getWhisperModelStatus(model: WhisperModel): Promise<{ cached: boolean }> {
  const cacheDir = getModelCacheDir();
  const modelDir = path.join(cacheDir, 'models--' + MODEL_IDS[model].replace('/', '--'));
  try {
    await fs.access(modelDir);
    return { cached: true };
  } catch {
    return { cached: false };
  }
}

export async function exportSrtFile(content: string, defaultName: string): Promise<string | null> {
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: defaultName.endsWith('.srt') ? defaultName : `${defaultName}.srt`,
    filters: [{ name: 'SubRip Subtitle', extensions: ['srt'] }],
  });
  if (canceled || !filePath) {
    return null;
  }
  await fs.writeFile(filePath, content, 'utf-8');
  return filePath;
}

export async function transcribeAudio(
  videoPath: string,
  model: WhisperModel,
  language: string,
  onProgress: (stage: 'model-load' | 'transcribing', progress: number) => void,
): Promise<CaptionSegment[]> {
  isCancelled = false;

  const workerPath = path.join(__dirname, 'transcribe-worker.js');
  const ffmpegPath = await getFFmpegPath();
  const modelCacheDir = getModelCacheDir();

  // OMP_NUM_THREADS=1 prevents onnxruntime-node from opening loopback sockets
  // for OpenMP thread coordination, which would trigger macOS firewall prompts.
  const workerEnv = { ...process.env, OMP_NUM_THREADS: '1' };

  return new Promise<CaptionSegment[]>((resolve, reject) => {
    log.info('[captions] spawning transcription worker');
    const worker = utilityProcess.fork(workerPath, [], { stdio: 'inherit', env: workerEnv });
    currentWorker = worker;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      currentWorker = null;
      fn();
    };

    worker.on(
      'message',
      (data: {
        type: string;
        stage?: string;
        progress?: number;
        segments?: CaptionSegment[];
        message?: string;
      }) => {
        if (data.type === 'progress' && data.stage != null && data.progress != null) {
          onProgress(data.stage as 'model-load' | 'transcribing', data.progress);
        } else if (data.type === 'result' && data.segments != null) {
          const { segments } = data;
          finish(() => resolve(segments));
        } else if (data.type === 'error') {
          finish(() => reject(new Error(data.message ?? 'Transcription failed')));
        }
      },
    );

    worker.on('exit', (code) => {
      finish(() => {
        if (isCancelled) {
          reject(new Error('Transcription cancelled'));
        } else if (code !== 0) {
          log.error('[captions] transcription worker crashed', { code });
          // null code = killed by signal (e.g. OOM SIGKILL); numeric = JS error
          const reason = code === null ? 'out of memory' : `exited with code ${code}`;
          reject(new Error(`Transcription process ${reason}`));
        }
        // code === 0: worker sent result before exiting; finish() is already a no-op
      });
    });

    worker.postMessage({
      videoPath,
      modelId: MODEL_IDS[model],
      language,
      modelCacheDir,
      ffmpegPath,
    });
  });
}
