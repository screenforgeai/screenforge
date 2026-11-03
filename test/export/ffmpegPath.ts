import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function getFFmpegExecutableName(platform = process.platform): string {
  return platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function getDefaultSystemFFmpegCandidates(platform = process.platform): string[] {
  if (platform === 'win32') {
    return [];
  }
  return ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
}

// The binary the app itself ships (native/bin/ffmpeg/<platform>-<arch>/), so
// the suite runs on a fresh checkout without a system FFmpeg.
function getBundledFFmpegCandidate(platform = process.platform, arch = process.arch): string {
  return fileURLToPath(
    new URL(
      `../../native/bin/ffmpeg/${platform}-${arch}/${getFFmpegExecutableName(platform)}`,
      import.meta.url,
    ),
  );
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

export async function resolveTestFFmpegPath(): Promise<string> {
  const overridePath = process.env.SCREENFORGE_FFMPEG_PATH?.trim();
  const candidates = [
    overridePath,
    getBundledFFmpegCandidate(),
    ...getDefaultSystemFFmpegCandidates(),
  ];

  for (const candidate of candidates) {
    if (await canAccess(candidate)) {
      return candidate as string;
    }
  }

  try {
    const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
    const executableName = getFFmpegExecutableName();
    const { stdout } = await execFileAsync(lookupCommand, [executableName]);
    const resolved = stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(Boolean);
    if (resolved) {
      return resolved;
    }
  } catch {
    // Fall through to the final error.
  }

  throw new Error(
    'FFmpeg not found. Run the download:ffmpeg:<platform> / build:ffmpeg:macos script, install a system FFmpeg, or set SCREENFORGE_FFMPEG_PATH.',
  );
}
