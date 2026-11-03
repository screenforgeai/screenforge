import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPaths from '../shared/ffmpeg-paths.js';

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split('=', 2);
    if (inlineValue != null) {
      parsed[key] = inlineValue;
      continue;
    }

    parsed[key] = argv[index + 1];
    index += 1;
  }

  return parsed;
}

async function readOptionalFile(filePath) {
  if (!filePath) {
    return null;
  }

  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function maybeExecFile(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, options);
  } catch {
    return null;
  }
}

async function collectGitMetadata(sourceDir) {
  const revision = await maybeExecFile('git', ['-C', sourceDir, 'rev-parse', 'HEAD']);
  const describe = await maybeExecFile('git', ['-C', sourceDir, 'describe', '--tags', '--always', '--dirty']);

  return {
    revision: revision?.stdout.trim() || null,
    describe: describe?.stdout.trim() || null,
  };
}

function parseConfigurationLine(ffmpegVersionOutput) {
  const line = ffmpegVersionOutput
    .split(/\r?\n/)
    .find((value) => value.startsWith('configuration:'));

  return line ? line.slice('configuration:'.length).trim() : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = args['source-dir'];
  const outputDir = args['output-dir'];
  const targetId = args['target-id'] ?? ffmpegPaths.getFFmpegTargetFolder();
  const deploymentTarget = args['deployment-target'] ?? null;
  const ffmpegPath = args['ffmpeg-path'] ?? path.join(outputDir, ffmpegPaths.getFFmpegExecutableName());
  const ffprobePath = args['ffprobe-path'] ?? path.join(outputDir, ffmpegPaths.getFFprobeExecutableName());
  const configureArgsFile = args['configure-args-file'] ?? null;

  if (!sourceDir || !outputDir) {
    throw new Error('write-ffmpeg-build-manifest requires --source-dir and --output-dir');
  }

  await fs.mkdir(outputDir, { recursive: true });

  const git = await collectGitMetadata(sourceDir);
  const ffmpegVersion = await execFileAsync(ffmpegPath, ['-version']);
  const ffprobeVersion = await maybeExecFile(ffprobePath, ['-version']);
  const configureArgsRaw = await readOptionalFile(configureArgsFile);
  const configureArgs = configureArgsRaw
    ? configureArgsRaw
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
    : null;

  const manifest = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    targetId,
    deploymentTarget,
    sourceDir,
    git,
    ffmpegPath,
    ffprobePath,
    ffmpegVersionLine: ffmpegVersion.stdout.split(/\r?\n/)[0]?.trim() ?? null,
    ffprobeVersionLine: ffprobeVersion?.stdout.split(/\r?\n/)[0]?.trim() ?? null,
    configurationLine: parseConfigurationLine(ffmpegVersion.stdout),
    configureArgs,
  };

  const manifestPath = ffmpegPaths.getBuildManifestPath(outputDir);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  process.stdout.write(`${manifestPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
