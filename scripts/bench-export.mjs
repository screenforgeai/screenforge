import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPaths from '../shared/ffmpeg-paths.js';
import processTree from '../shared/process-tree.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MANIFEST_DIR = path.join(ROOT, 'test/fixtures/export/manifests');
const EXPORT_HARNESS_TIMEOUT_MS = 180_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function canAccess(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveBenchFFmpegPath() {
  const overridePath = process.env.SCREENFORGE_FFMPEG_PATH?.trim();
  const candidates = [
    overridePath,
    ffmpegPaths.getDevBundledFFmpegPath(ROOT),
    ...ffmpegPaths.getDefaultSystemFFmpegCandidates(),
  ];

  for (const candidate of candidates) {
    if (await canAccess(candidate)) {
      return candidate;
    }
  }

  return ffmpegPaths.getFFmpegExecutableName();
}

function formatMs(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBudget(ms) {
  return ms == null ? 'n/a' : formatMs(ms);
}

function formatFileSize(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRealtimeFactor(durationSeconds, elapsedMs) {
  if (!durationSeconds || !elapsedMs) {
    return 'n/a';
  }

  return `${(durationSeconds / Math.max(elapsedMs / 1000, 0.001)).toFixed(2)}x`;
}

function formatPerfBreakdown(perf) {
  if (!perf) {
    return 'n/a';
  }

  return [
    `decode=${formatMs(perf.decodeWaitMs)}`,
    `render=${formatMs(perf.renderMs)}`,
    `encode=${formatMs(perf.encodeMs)}`,
    `audio=${formatMs(perf.audioRenderMs)}`,
  ].join(', ');
}

async function runProcess(command, args, options = {}) {
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

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
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

function launchHarnessProcess(manifestPath, resultPath) {
  const child = spawn('/bin/zsh', ['-lc', 'tail -f /dev/null | script -q /dev/null pnpm start'], {
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
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const close = new Promise((resolve, reject) => {
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

async function waitForFinalHarnessResult(resultPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(resultPath, 'utf8');
      const parsed = JSON.parse(raw);
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

async function stopHarnessProcess(launch) {
  const pid = launch.child.pid;
  if (pid) {
    await processTree.terminateProcessTree(pid).catch(() => undefined);
  }

  await Promise.race([launch.close.catch(() => null), delay(5_000)]);
}

async function assertPrerequisites() {
  const ffmpegPath = await resolveBenchFFmpegPath();

  await runProcess(ffmpegPath, ['-version'], {
    cwd: ROOT,
    timeoutMs: 15_000,
  }).catch((error) => {
    throw new Error(`FFmpeg is required for bench:export.\n${String(error)}`);
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
    throw new Error(`A PTY-capable 'script' command is required for bench:export.\n${String(error)}`);
  });
}

async function runScenario(manifestFileName) {
  const manifestPath = path.join(MANIFEST_DIR, manifestFileName);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `screenforge-bench-${manifest.id}-`));
  const resultPath = path.join(tempDir, 'result.json');
  const launch = launchHarnessProcess(manifestPath, resultPath);

  try {
    const result = await waitForFinalHarnessResult(resultPath, EXPORT_HARNESS_TIMEOUT_MS);
    if (!result.success) {
      throw new Error(
        `Harness failed for ${manifest.id}: ${result.error ?? 'unknown error'}\nSTDOUT:\n${launch.getStdout()}\nSTDERR:\n${launch.getStderr()}`,
      );
    }

    const stats = result.outputPath ? await fs.stat(result.outputPath) : null;

    return {
      manifest,
      result,
      outputSizeBytes: stats?.size ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\nSTDOUT:\n${launch.getStdout()}\nSTDERR:\n${launch.getStderr()}`);
  } finally {
    await stopHarnessProcess(launch);
  }
}

function parseArgs(argv) {
  const manifestNames = [];
  let jsonPath = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }

    if (arg === '--json') {
      jsonPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    manifestNames.push(arg);
  }

  return { manifestNames, jsonPath };
}

async function main() {
  const { manifestNames, jsonPath } = parseArgs(process.argv.slice(2));
  const scenarios =
    manifestNames.length > 0
      ? manifestNames
      : (await fs.readdir(MANIFEST_DIR)).filter((entry) => entry.endsWith('.json')).sort();

  await assertPrerequisites();

  console.log(`Running ${scenarios.length} export benchmark scenario(s)...`);

  const summary = [];

  for (const scenario of scenarios) {
    console.log(`\n[bench:export] ${scenario}`);
    const startedAt = Date.now();
    const { manifest, result, outputSizeBytes } = await runScenario(scenario);
    const overBudget =
      manifest.expected?.maxElapsedMs != null && result.elapsedMs > manifest.expected.maxElapsedMs;

    summary.push({
      manifest: scenario,
      id: manifest.id,
      elapsedMs: result.elapsedMs,
      budgetMs: manifest.expected?.maxElapsedMs ?? null,
      overBudget,
      captureFrameCount: result.captureFrameCount ?? null,
      outputFps: result.outputInfo?.fps ?? null,
      outputWidth: result.outputInfo?.width ?? null,
      outputHeight: result.outputInfo?.height ?? null,
      outputDuration: result.outputInfo?.duration ?? null,
      capturePerf: result.capturePerf ?? null,
      realtimeFactor:
        result.outputInfo?.duration != null
          ? result.outputInfo.duration / Math.max(result.elapsedMs / 1000, 0.001)
          : null,
      outputSizeBytes,
      wallClockMs: Date.now() - startedAt,
    });

    console.log(
      [
        `elapsed=${formatMs(result.elapsedMs)}`,
        `budget=${formatBudget(manifest.expected?.maxElapsedMs ?? null)}`,
        `frames=${result.captureFrameCount ?? 'n/a'}`,
        `output=${result.outputInfo?.width ?? '?'}x${result.outputInfo?.height ?? '?'}@${result.outputInfo?.fps ?? '?'}fps`,
        `duration=${result.outputInfo?.duration?.toFixed(2) ?? 'n/a'}s`,
        `realtime=${formatRealtimeFactor(result.outputInfo?.duration ?? null, result.elapsedMs)}`,
        `size=${outputSizeBytes == null ? 'n/a' : formatFileSize(outputSizeBytes)}`,
        `perf=${formatPerfBreakdown(result.capturePerf)}`,
        overBudget ? 'status=OVER_BUDGET' : 'status=OK',
      ].join(' | '),
    );
  }

  if (jsonPath) {
    await fs.mkdir(path.dirname(path.resolve(jsonPath)), { recursive: true });
    await fs.writeFile(path.resolve(jsonPath), JSON.stringify(summary, null, 2));
    console.log(`\nWrote benchmark report to ${path.resolve(jsonPath)}`);
  }

  const overBudgetCount = summary.filter((entry) => entry.overBudget).length;
  console.log('\nSummary');
  console.table(
    summary.map((entry) => ({
      manifest: entry.manifest,
      elapsed: formatMs(entry.elapsedMs),
      budget: formatBudget(entry.budgetMs),
      frames: entry.captureFrameCount ?? 'n/a',
      output: `${entry.outputWidth ?? '?'}x${entry.outputHeight ?? '?'}@${entry.outputFps ?? '?'}fps`,
      duration: entry.outputDuration?.toFixed(2) ?? 'n/a',
      realtime: entry.realtimeFactor == null ? 'n/a' : `${entry.realtimeFactor.toFixed(2)}x`,
      size: entry.outputSizeBytes == null ? 'n/a' : formatFileSize(entry.outputSizeBytes),
      perf: formatPerfBreakdown(entry.capturePerf),
      status: entry.overBudget ? 'OVER_BUDGET' : 'OK',
    })),
  );

  if (overBudgetCount > 0) {
    console.warn(`\n${overBudgetCount} scenario(s) exceeded their benchmark budget.`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
