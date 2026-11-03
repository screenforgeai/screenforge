import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import processTree from '../shared/process-tree.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEFAULT_MANIFEST = 'mp4-smoke.json';
const DEFAULT_APP_BUNDLE = path.join(
  ROOT,
  'out',
  'screenforge-darwin-arm64',
  'screenforge.app',
);
const PACKAGED_EXPORT_HARNESS_REQUEST_PATH = path.join(
  os.tmpdir(),
  'screenforge-packaged-export-harness.json',
);
const DEFAULT_BINARY = path.join(
  DEFAULT_APP_BUNDLE,
  'Contents',
  'MacOS',
  'screenforge',
);

function parseArgs(argv) {
  let manifestName = DEFAULT_MANIFEST;
  let launchTarget = DEFAULT_BINARY;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--binary') {
      launchTarget = argv[index + 1] ?? launchTarget;
      index += 1;
      continue;
    }
    manifestName = arg;
  }

  return { manifestName, launchTarget };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHarnessBootPath(resultPath) {
  return `${resultPath}.boot`;
}

async function waitForHarnessBoot(resultPath, timeoutMs) {
  const bootPath = getHarnessBootPath(resultPath);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(bootPath, 'utf8');
      return JSON.parse(raw);
    } catch {
      // Keep polling.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for packaged harness boot marker at ${bootPath}`);
}

async function waitForResult(resultPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(resultPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.success || parsed.error !== 'Harness started') {
        return parsed;
      }
    } catch {
      // Keep polling.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for packaged export result at ${resultPath}`);
}

function resolveMacAppBundlePath(targetPath) {
  const normalized = path.resolve(targetPath);
  const appMarker = '.app';
  const appIndex = normalized.indexOf(appMarker);
  if (appIndex === -1) {
    return normalized;
  }

  return normalized.slice(0, appIndex + appMarker.length);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function createLaunchSpec(targetPath, manifestPath, resultPath) {
  const harnessArgs = [
    `--export-harness-manifest=${manifestPath}`,
    `--export-harness-result=${resultPath}`,
  ];

  const normalizedTarget = path.resolve(targetPath);
  if (process.platform === 'darwin' && normalizedTarget === path.resolve(DEFAULT_BINARY)) {
    return {
      command: normalizedTarget,
      args: [],
      launchTargetDescription: normalizedTarget,
      executablePath: normalizedTarget,
      usesPackagedHarnessRequestFile: true,
      childExitIsFatal: true,
    };
  }

  if (process.platform === 'darwin' && normalizedTarget.endsWith('.app')) {
    const appBundlePath = resolveMacAppBundlePath(normalizedTarget);
    if (appBundlePath.endsWith('.app')) {
      const relativeAppBundlePath = path.relative(ROOT, appBundlePath);
      const openTarget = relativeAppBundlePath.startsWith('..')
        ? appBundlePath
        : relativeAppBundlePath;
      return {
        command: '/bin/zsh',
        args: ['-lc', `open ${shellEscape(openTarget)}`],
        launchTargetDescription: appBundlePath,
        executablePath: path.join(appBundlePath, 'Contents', 'MacOS', 'screenforge'),
        usesPackagedHarnessRequestFile: true,
        childExitIsFatal: false,
      };
    }
  }

  return {
    command: normalizedTarget,
    args: harnessArgs,
    launchTargetDescription: normalizedTarget,
    executablePath: normalizedTarget,
    usesPackagedHarnessRequestFile: false,
    childExitIsFatal: true,
  };
}

async function terminateExistingPackagedInstance(executablePath) {
  await new Promise((resolve) => {
    const killer = spawn('pkill', ['-f', executablePath], {
      stdio: 'ignore',
    });

    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
  });

  await delay(500);
}

async function main() {
  const { manifestName, launchTarget } = parseArgs(process.argv.slice(2));
  const manifestPath = path.join(ROOT, 'test', 'fixtures', 'export', 'manifests', manifestName);
  const resultDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenforge-export-packaged-'));
  const resultPath = path.join(resultDir, 'result.json');
  const launchSpec = createLaunchSpec(launchTarget, manifestPath, resultPath);

  await fs.access(launchSpec.launchTargetDescription);
  await fs.access(manifestPath);
  await fs.mkdir(resultDir, { recursive: true });

  if (launchSpec.usesPackagedHarnessRequestFile) {
    await terminateExistingPackagedInstance(launchSpec.executablePath);
    await fs.writeFile(
      PACKAGED_EXPORT_HARNESS_REQUEST_PATH,
      JSON.stringify(
        {
          manifestPath,
          resultPath,
          requestedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  const child = spawn(launchSpec.command, launchSpec.args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const spawnErrorPromise = new Promise((_, reject) => {
    child.once('error', reject);
  });

  const exitPromise = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    const bootRace = [
      waitForHarnessBoot(resultPath, 30_000),
      waitForResult(resultPath, 30_000),
      spawnErrorPromise,
    ];

    if (launchSpec.childExitIsFatal) {
      bootRace.push(
        exitPromise.then(({ code, signal }) => {
          throw new Error(
            `Packaged app exited before harness booted (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
          );
        }),
      );
    }

    await Promise.race(bootRace);

    const result = await waitForResult(resultPath, 180_000);
    if (!result.success) {
      throw new Error(result.error ?? 'unknown packaged export error');
    }

    process.stdout.write('Packaged export verification passed\n');
    process.stdout.write(`manifest: ${manifestName}\n`);
    process.stdout.write(`output: ${result.outputPath}\n`);
    process.stdout.write(`elapsedMs: ${result.elapsedMs}\n`);
    return;
  } finally {
    if (launchSpec.usesPackagedHarnessRequestFile) {
      await fs.rm(PACKAGED_EXPORT_HARNESS_REQUEST_PATH, { force: true }).catch(() => undefined);
    }

    if (child.pid) {
      await processTree.terminateProcessTree(child.pid).catch(() => undefined);
    }

    if (stdout.trim()) {
      process.stdout.write(`stdout:\n${stdout}\n`);
    }
    if (stderr.trim()) {
      process.stdout.write(`stderr:\n${stderr}\n`);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
