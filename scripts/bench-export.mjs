import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpegPaths from '../shared/ffmpeg-paths.js';
import processTree from '../shared/process-tree.js';
import {
  RELEASE_BENCHMARKS,
  buildBenchmarkReport,
  buildHarnessLaunch,
  buildSampleMediaArgs,
  buildTreeKillCommand,
  formatMarkdownRow,
  pickSampleEncoder,
  resolveBenchmarkManifest,
  summarizeHarnessResult,
} from './bench-export-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  const launch = buildHarnessLaunch(process.platform);
  const child = spawn(launch.command, launch.args, {
    cwd: ROOT,
    env: {
      ...process.env,
      CI: '1',
      SCREENFORGE_EXPORT_TEST_MANIFEST: manifestPath,
      SCREENFORGE_EXPORT_TEST_RESULT: resultPath,
    },
    // Windows has no script(1): keep a stdin pipe open for electron-forge instead.
    detached: process.platform !== 'win32',
    shell: launch.shell,
    stdio: [process.platform === 'win32' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
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
    const treeKill = buildTreeKillCommand(process.platform, pid);
    if (treeKill) {
      await runProcess(treeKill.command, treeKill.args, { cwd: ROOT, timeoutMs: 15_000 }).catch(
        () => undefined,
      );
    } else {
      await processTree.terminateProcessTree(pid).catch(() => undefined);
    }
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

  // Windows launches the harness without script(1), so only the PTY check is skipped.
  if (process.platform === 'win32') {
    return;
  }

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
    throw new Error(
      `A PTY-capable 'script' command is required for bench:export.\n${String(error)}`,
    );
  });
}

async function runScenario(manifestFileName, manifestDir = MANIFEST_DIR) {
  const manifestPath = path.join(manifestDir, manifestFileName);
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
  let release = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }

    if (arg === '--release') {
      release = true;
      continue;
    }

    if (arg === '--json') {
      jsonPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    manifestNames.push(arg);
  }

  return { manifestNames, jsonPath, release };
}

async function readFirstLine(command, args) {
  try {
    const { stdout } = await runProcess(command, args, { cwd: ROOT, timeoutMs: 15_000 });
    return stdout.split('\n')[0].trim() || null;
  } catch {
    return null;
  }
}

async function collectEnvironment(ffmpegPath) {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const cpus = os.cpus();
  return {
    appVersion: pkg.version,
    gitCommit: await readFirstLine('git', ['rev-parse', '--short', 'HEAD']),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
    cpuCount: cpus.length,
    totalMemoryGb: Math.round(os.totalmem() / 1024 ** 3),
    nodeVersion: process.version,
    ffmpegVersion: await readFirstLine(ffmpegPath, ['-version']),
  };
}

/**
 * Generates the release sample media (cached across runs) and writes the
 * manifests that point at it. Returns the directory holding those manifests.
 */
async function prepareReleaseBenchmarks(ffmpegPath) {
  const cacheDir = path.join(os.tmpdir(), 'screenforge-bench-export');
  await fs.mkdir(cacheDir, { recursive: true });
  const { stdout: encoders } = await runProcess(ffmpegPath, ['-hide_banner', '-encoders'], {
    cwd: ROOT,
    timeoutMs: 15_000,
  });
  const encoder = pickSampleEncoder(encoders);
  if (!encoder) {
    throw new Error(`No H.264 encoder found in ${ffmpegPath} to generate the benchmark sample.`);
  }

  const manifestNames = [];
  for (const preset of RELEASE_BENCHMARKS) {
    const mediaPath = path.join(cacheDir, `sample-${preset.id}.mp4`);
    if (!(await canAccess(mediaPath))) {
      console.log(`[bench:export] generating ${preset.label} sample with ${encoder}...`);
      const generated = await runProcess(
        ffmpegPath,
        buildSampleMediaArgs(preset, encoder, mediaPath),
        { cwd: ROOT, timeoutMs: 600_000 },
      );
      if (generated.exitCode !== 0) {
        await fs.rm(mediaPath, { force: true });
        throw new Error(`Could not generate the ${preset.label} sample:\n${generated.stderr}`);
      }
    }
    const manifest = resolveBenchmarkManifest(preset, mediaPath);
    const manifestName = `${manifest.id}.json`;
    await fs.writeFile(path.join(cacheDir, manifestName), JSON.stringify(manifest, null, 2));
    manifestNames.push(manifestName);
  }
  return { manifestDir: cacheDir, manifestNames, encoder };
}

async function main() {
  const { manifestNames, jsonPath, release } = parseArgs(process.argv.slice(2));

  await assertPrerequisites();
  const ffmpegPath = await resolveBenchFFmpegPath();
  const environment = await collectEnvironment(ffmpegPath);

  let manifestDir = MANIFEST_DIR;
  let scenarios =
    manifestNames.length > 0
      ? manifestNames
      : (await fs.readdir(MANIFEST_DIR)).filter((entry) => entry.endsWith('.json')).sort();
  if (release) {
    const prepared = await prepareReleaseBenchmarks(ffmpegPath);
    manifestDir = prepared.manifestDir;
    scenarios = prepared.manifestNames;
    // The sample's encoding is the one thing that can differ between machines.
    environment.sampleEncoder = prepared.encoder;
  }

  console.log(`Running ${scenarios.length} export benchmark scenario(s)...`);

  const summary = [];

  for (const scenario of scenarios) {
    console.log(`\n[bench:export] ${scenario}`);
    const startedAt = Date.now();
    const { manifest, result, outputSizeBytes } = await runScenario(scenario, manifestDir);
    const entry = summarizeHarnessResult(
      scenario,
      manifest,
      result,
      outputSizeBytes,
      Date.now() - startedAt,
    );
    const overBudget = entry.overBudget;
    summary.push(entry);

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
    const report = buildBenchmarkReport({
      environment,
      generatedAt: new Date().toISOString(),
      results: summary,
    });
    await fs.mkdir(path.dirname(path.resolve(jsonPath)), { recursive: true });
    await fs.writeFile(path.resolve(jsonPath), JSON.stringify(report, null, 2));
    console.log(`\nWrote benchmark report to ${path.resolve(jsonPath)}`);
  }

  if (release) {
    console.log('\nRows for docs/EXPORT_BENCHMARKS.md:');
    for (const entry of summary) {
      console.log(formatMarkdownRow(environment, entry));
    }
  }

  const overBudgetCount = summary.filter((entry) => entry.overBudget).length;
  console.log('\nSummary');
  console.table(
    summary.map((entry) => ({
      manifest: entry.manifest,
      elapsed: formatMs(entry.seconds * 1000),
      budget: formatBudget(entry.budgetMs),
      frames: entry.captureFrameCount ?? 'n/a',
      output: `${entry.outputWidth ?? '?'}x${entry.outputHeight ?? '?'}@${entry.outputFps ?? '?'}fps`,
      duration: entry.contentSeconds?.toFixed(2) ?? 'n/a',
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
