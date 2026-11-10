import { app, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RecordingResult } from '../../../src/types/index';
import {
  buildSampleRecordingResult,
  SAMPLE_PROJECT_VIDEO_FILENAME,
  type SampleProjectManifest,
} from '../../../src/lib/sampleProject';
import sampleManifest from '../../../src/assets/sample-project/sample-project.json';
import { probeExportSource } from '../export/service';

const IMPORTS_DIR = () => path.join(app.getPath('userData'), 'imports');

async function ensureImportsDir(): Promise<string> {
  const dir = IMPORTS_DIR();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Electron 43+ opens dialogs in Downloads unless given a defaultPath, and the
// OS no longer remembers the last folder, so remember it for this session.
let lastImportDir: string | undefined;

export async function pickAndImportVideo(): Promise<RecordingResult | null> {
  const result = await dialog.showOpenDialog({
    title: 'Import Video',
    defaultPath: lastImportDir,
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v'] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const sourcePath = result.filePaths[0]!;
  lastImportDir = path.dirname(sourcePath);
  return importVideoFromPath(sourcePath);
}

export async function importVideoFromPath(sourcePath: string): Promise<RecordingResult | null> {
  const info = await probeExportSource(sourcePath);

  if (!info.duration || info.duration <= 0) {
    throw new Error('Could not determine video duration from file');
  }

  const width = info.width ?? 1920;
  const height = info.height ?? 1080;

  const importsDir = await ensureImportsDir();
  const ext = path.extname(sourcePath).toLowerCase() || '.mp4';
  const destPath = path.join(importsDir, `import-${randomUUID()}${ext}`);

  await fs.copyFile(sourcePath, destPath);

  return {
    filePath: destPath,
    mouseData: [],
    duration: info.duration,
    startTime: Date.now(),
    recordingArea: { x: 0, y: 0, width, height },
    hasEmbeddedAudio: true,
    isImported: true,
  };
}

// Packaged builds ship the video as an extraResource (forge.config.ts); in dev
// it is read straight from the source tree.
function getSampleProjectVideoPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, SAMPLE_PROJECT_VIDEO_FILENAME)
    : path.join(app.getAppPath(), 'src/assets/sample-project', SAMPLE_PROJECT_VIDEO_FILENAME);
}

/**
 * Copies the bundled sample recording into imports, like an imported video,
 * and returns it with its scripted cursor data. Nothing is written to the
 * project library: the sample becomes a project only when the user saves it.
 */
export async function importSampleProject(): Promise<RecordingResult> {
  const importsDir = await ensureImportsDir();
  const destPath = path.join(importsDir, `sample-${randomUUID()}.mp4`);

  await fs.copyFile(getSampleProjectVideoPath(), destPath);

  return buildSampleRecordingResult(sampleManifest as SampleProjectManifest, destPath, Date.now());
}
