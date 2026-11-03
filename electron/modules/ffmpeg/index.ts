/**
 * Resolves the FFmpeg binary path at runtime.
 * Prefer an explicit override, then the repo-managed bundled binary, then system paths.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';
import log from '../../lib/logger';

const execFileAsync = promisify(execFile);

let resolvedPath: string | null = null;

function getFFmpegExecutableName(platform = process.platform): string {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function getDefaultSystemFFmpegCandidates(platform = process.platform): string[] {
  if (platform === 'win32') {
    return [];
  }

  return ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
}

function getBundledTargetFolder(platform = process.platform, arch = process.arch): string {
  return `${platform}-${arch}`;
}

async function canAccess(filePath: string | null | undefined): Promise<boolean> {
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

function getPackagedBinaryCandidate(): string | null {
  if (!app.isPackaged) {
    return null;
  }

  return path.join(
    process.resourcesPath,
    'ffmpeg',
    getBundledTargetFolder(),
    getFFmpegExecutableName(),
  );
}

function getDevBundledBinaryCandidate(): string {
  return path.join(
    app.getAppPath(),
    'native',
    'bin',
    'ffmpeg',
    getBundledTargetFolder(),
    getFFmpegExecutableName(),
  );
}

function getEnvironmentOverrideCandidate(): string | null {
  const overridePath = process.env.SCREENFORGE_FFMPEG_PATH?.trim();
  if (!overridePath) {
    return null;
  }

  return path.resolve(overridePath);
}

async function resolveFromSystemPath(): Promise<string> {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
  const executableName = getFFmpegExecutableName();
  const { stdout } = await execFileAsync(lookupCommand, [executableName]);
  return stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean) as string;
}

export async function getFFmpegPath(): Promise<string> {
  if (resolvedPath) {
    return resolvedPath;
  }

  const candidates = [
    getEnvironmentOverrideCandidate(),
    getPackagedBinaryCandidate(),
    getDevBundledBinaryCandidate(),
    ...getDefaultSystemFFmpegCandidates(),
  ];

  for (const candidate of candidates) {
    if (!(await canAccess(candidate))) {
      continue;
    }

    resolvedPath = candidate;
    log.info('[ffmpeg] found at:', candidate);
    return candidate;
  }

  try {
    resolvedPath = await resolveFromSystemPath();
    log.info('[ffmpeg] found via PATH:', resolvedPath);
    return resolvedPath;
  } catch {
    throw new Error(
      'FFmpeg not found. No bundled binary, override path, or system FFmpeg installation was available.',
    );
  }
}

export async function checkFFmpeg(): Promise<void> {
  try {
    await getFFmpegPath();
  } catch (err) {
    log.warn('[ffmpeg] not available:', err);
  }
}

export async function isFFmpegAvailable(): Promise<boolean> {
  try {
    await getFFmpegPath();
    return true;
  } catch {
    return false;
  }
}

export function resetFFmpegPath(): void {
  resolvedPath = null;
}
