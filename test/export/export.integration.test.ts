import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  ExportFixtureManifest,
  ExportHarnessResult,
} from '../../electron/testing/exportHarnessManifest';
import { normalizeExportFpsForFormat } from '../../src/lib/export/gif';
import { resolveTestFFmpegPath } from './ffmpegPath';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const processTree = require('../../shared/process-tree.js');

const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_DIR = path.join(ROOT, 'test/fixtures/export/manifests');
const EXPORT_HARNESS_TIMEOUT_MS = 180_000;
let ffmpegPath = 'ffmpeg';

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface MediaInspection {
  duration: number | null;
  width: number | null;
  height: number | null;
  videoStreams: number;
  audioStreams: number;
}

interface HarnessLaunch {
  child: import('node:child_process').ChildProcess;
  close: Promise<number | null>;
  getStdout: () => string;
  getStderr: () => string;
}

async function readManifest(name: string): Promise<ExportFixtureManifest> {
  const manifestPath = path.join(MANIFEST_DIR, name);
  return JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ExportFixtureManifest;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs ?? 30_000);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once('close', (exitCode) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(
          new Error(
            `Command timed out after ${options.timeoutMs ?? 30_000}ms: ${command} ${args.join(
              ' ',
            )}\n${stderr || stdout}`,
          ),
        );
        return;
      }

      resolve({ exitCode, stdout, stderr });
    });
  });
}

function launchHarnessProcess(manifestPath: string, resultPath: string): HarnessLaunch {
  // BSD script(1) takes the command as positional args; util-linux needs -c.
  const startCommand =
    process.platform === 'darwin'
      ? 'tail -f /dev/null | script -q /dev/null pnpm start'
      : 'tail -f /dev/null | script -qefc "pnpm start" /dev/null';
  const child = spawn('/bin/zsh', ['-lc', startCommand], {
    cwd: ROOT,
    env: {
      ...process.env,
      CI: '1',
      SCREENFORGE_EXPORT_TEST_MANIFEST: manifestPath,
      SCREENFORGE_EXPORT_TEST_RESULT: resultPath,
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const close = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  return {
    child,
    close,
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

async function waitForFinalHarnessResult(
  resultPath: string,
  timeoutMs: number,
): Promise<ExportHarnessResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(resultPath, 'utf8');
      const parsed = JSON.parse(raw) as ExportHarnessResult;
      if (parsed.success || parsed.error !== 'Harness started') {
        return parsed;
      }
    } catch {
      // Keep polling until the harness writes its final result or times out.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for export harness result at ${resultPath}`);
}

async function stopHarnessProcess(launch: HarnessLaunch): Promise<void> {
  const pid = launch.child.pid;
  if (pid) {
    await processTree.terminateProcessTree(pid).catch(() => undefined);
  }

  await Promise.race([launch.close.catch(() => null), delay(5_000)]);
}

async function inspectMedia(filePath: string): Promise<MediaInspection> {
  const result = await runProcess(ffmpegPath, ['-hide_banner', '-i', filePath], {
    cwd: ROOT,
    timeoutMs: 30_000,
  });
  const output = `${result.stdout}\n${result.stderr}`;

  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 +
      Number(durationMatch[2]) * 60 +
      Number(durationMatch[3])
    : null;

  const lines = output.split(/\r?\n/);
  const videoLines = lines.filter((line) => line.includes('Stream #') && line.includes('Video:'));
  const audioLines = lines.filter((line) => line.includes('Stream #') && line.includes('Audio:'));
  const firstVideoLine = videoLines[0] ?? '';
  const sizeMatch = firstVideoLine.match(/(\d{2,5})x(\d{2,5})/);

  return {
    duration,
    width: sizeMatch ? Number(sizeMatch[1]) : null,
    height: sizeMatch ? Number(sizeMatch[2]) : null,
    videoStreams: videoLines.length,
    audioStreams: audioLines.length,
  };
}

async function sampleFrameHash(filePath: string, timeSeconds: number): Promise<string> {
  const child = spawn(
    ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      timeSeconds.toFixed(3),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-f',
      'image2pipe',
      '-vcodec',
      'png',
      'pipe:1',
    ],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const chunks: Buffer[] = [];
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    chunks.push(Buffer.from(chunk));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`ffmpeg frame extraction failed for ${filePath} at ${timeSeconds}s\n${stderr}`);
  }

  const pngBuffer = Buffer.concat(chunks);
  if (pngBuffer.length === 0) {
    throw new Error(`ffmpeg returned an empty frame for ${filePath} at ${timeSeconds}s`);
  }

  return createHash('sha256').update(pngBuffer).digest('hex');
}

async function runHarnessScenario(manifestFileName: string): Promise<{
  manifest: ExportFixtureManifest;
  result: ExportHarnessResult;
  stdout: string;
  stderr: string;
}> {
  const manifest = await readManifest(manifestFileName);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `screenforge-export-${manifest.id}-`));
  const manifestPath = path.join(MANIFEST_DIR, manifestFileName);
  const resultPath = path.join(tempDir, 'result.json');
  const launch = launchHarnessProcess(manifestPath, resultPath);

  try {
    const result = await waitForFinalHarnessResult(resultPath, EXPORT_HARNESS_TIMEOUT_MS);
    if (!result.success) {
      throw new Error(
        `Harness failed for ${manifest.id}: ${result.error ?? 'unknown error'}\nSTDOUT:\n${launch.getStdout()}\nSTDERR:\n${launch.getStderr()}`,
      );
    }

    return {
      manifest,
      result,
      stdout: launch.getStdout(),
      stderr: launch.getStderr(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message}\nSTDOUT:\n${launch.getStdout()}\nSTDERR:\n${launch.getStderr()}`,
    );
  } finally {
    await stopHarnessProcess(launch);
  }
}

async function assertMovingOutput(
  outputPath: string,
  duration: number,
  minDistinctFrameHashes: number,
): Promise<void> {
  const sampleTimes = [0.05, Math.max(duration / 2, 0.05), Math.max(duration - 0.1, 0.05)];
  const hashes = await Promise.all(sampleTimes.map((time) => sampleFrameHash(outputPath, time)));
  expect(new Set(hashes).size).toBeGreaterThanOrEqual(minDistinctFrameHashes);
}

beforeAll(async () => {
  ffmpegPath = await resolveTestFFmpegPath();

  await runProcess(ffmpegPath, ['-version'], {
    cwd: ROOT,
    timeoutMs: 15_000,
  }).catch((error) => {
    throw new Error(`FFmpeg is required for test:export.\n${String(error)}`);
  });

  await runProcess(
    'script',
    process.platform === 'darwin'
      ? ['-q', '/dev/null', '/bin/echo', 'screenforge-export']
      : ['-qefc', 'echo screenforge-export', '/dev/null'],
    {
      cwd: ROOT,
      timeoutMs: 15_000,
    },
  ).catch((error) => {
    throw new Error(`A PTY-capable 'script' command is required for test:export.\n${String(error)}`);
  });
});

describe.sequential('export integration', () => {
  const scenarios = [
    'mp4-smoke.json',
    'mp4-audio.json',
    'mp4-camera.json',
    'mp4-timeline-edit.json',
    'mp4-duration-overrun.json',
    'mp4-aspect-4x3.json',
    'gif-smoke.json',
  ];

  it.each(scenarios)('exports %s through the real Electron harness', async (manifestFileName) => {
    const { manifest, result } = await runHarnessScenario(manifestFileName);
    expect(result.outputPath).toBeTruthy();
    expect(result.captureFrameCount).toBeGreaterThan(0);
    expect(result.outputPath && path.extname(result.outputPath)).toBe(
      manifest.export.format === 'gif' ? '.gif' : `.${manifest.export.format}`,
    );
    expect(result.effectiveFps).toBe(
      normalizeExportFpsForFormat(manifest.export.format, manifest.export.fps),
    );

    const outputInfo = await inspectMedia(result.outputPath as string);
    expect(outputInfo.videoStreams).toBeGreaterThan(0);
    expect(outputInfo.width).toBe(result.targetWidth);
    expect(outputInfo.height).toBe(result.targetHeight);
    expect(outputInfo.duration).not.toBeNull();
    const expectedDuration = manifest.expected.outputDurationSeconds ?? result.duration ?? 0;
    expect(Math.abs((outputInfo.duration ?? 0) - expectedDuration)).toBeLessThanOrEqual(
      manifest.expected.durationToleranceSeconds,
    );

    if (manifest.expected.audio) {
      expect(outputInfo.audioStreams).toBeGreaterThan(0);
    } else {
      expect(outputInfo.audioStreams).toBe(0);
    }

    if (manifest.expected.moving) {
      await assertMovingOutput(
        result.outputPath as string,
        outputInfo.duration ?? result.duration ?? 0.5,
        manifest.expected.minDistinctFrameHashes,
      );
    }

    if (manifest.expected.maxElapsedMs != null) {
      expect(result.elapsedMs).toBeLessThanOrEqual(manifest.expected.maxElapsedMs);
    }
  }, EXPORT_HARNESS_TIMEOUT_MS);
});
