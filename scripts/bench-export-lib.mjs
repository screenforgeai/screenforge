/**
 * Pure helpers for scripts/bench-export.mjs — the release export benchmark.
 *
 * The release benchmark exports one fixed sample project at 1080p and at 4K
 * with the export dialog's default settings (MP4, 60 fps, High quality, with
 * audio), so numbers from different machines and releases compare like for
 * like. The sample media is generated with FFmpeg's synthetic sources rather
 * than committed, so the repo doesn't carry a 4K video.
 */

import path from 'node:path';

const SAMPLE_DURATION_SECONDS = 20;
const SAMPLE_FPS = 60;

const DEFAULT_EXPORT = {
  format: 'mp4',
  fps: 60,
  quality: 'high',
  includeAudio: true,
  audioBitrateKbps: 320,
};

export const RELEASE_BENCHMARKS = [
  {
    id: '1080p',
    label: '1080p',
    width: 1920,
    height: 1080,
    export: { ...DEFAULT_EXPORT, resolution: '1080p' },
  },
  {
    id: '4k',
    label: '4K',
    width: 3840,
    height: 2160,
    export: { ...DEFAULT_EXPORT, resolution: '4k' },
  },
];

// libx264 where the FFmpeg build has it; otherwise whatever H.264 encoder the
// platform's bundled (LGPL) FFmpeg ships. Only the sample's encoding differs.
const SAMPLE_ENCODERS = ['libx264', 'libopenh264', 'h264_videotoolbox', 'h264_mf'];

/** Picks the encoder for the sample media from `ffmpeg -encoders` output. */
export function pickSampleEncoder(encodersOutput) {
  const available = new Set(
    encodersOutput
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[1])
      .filter(Boolean),
  );
  return SAMPLE_ENCODERS.find((encoder) => available.has(encoder)) ?? null;
}

/**
 * FFmpeg args for the sample recording: a moving test pattern (detail, text
 * and motion, like a screen recording) with a steady tone, at the preset's
 * size and 60 fps, 20 seconds long.
 */
export function buildSampleMediaArgs(preset, encoder, outPath) {
  const { width, height } = preset;
  // Roughly what the native recorders write for a screen of this size.
  const bitrate = width >= 3840 ? '40M' : '12M';
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${width}x${height}:rate=${SAMPLE_FPS}:duration=${SAMPLE_DURATION_SECONDS}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:sample_rate=48000:duration=${SAMPLE_DURATION_SECONDS}`,
    '-c:v',
    encoder,
    '-b:v',
    bitrate,
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath,
  ];
}

/** The export manifest the harness runs for a preset, using the generated sample. */
export function resolveBenchmarkManifest(preset, mediaPath) {
  const id = `release-${preset.id}`;
  return {
    id,
    description: `Release export benchmark: the fixed ${SAMPLE_DURATION_SECONDS}s sample exported at ${preset.label} with the default export settings.`,
    recording: {
      filePath: mediaPath,
      mouseData: [],
      duration: SAMPLE_DURATION_SECONDS,
      startTime: 1700000000000,
      recordingArea: { x: 0, y: 0, width: preset.width, height: preset.height },
    },
    mediaSegments: [
      {
        id: 'sample',
        timelineStart: 0,
        timelineEnd: SAMPLE_DURATION_SECONDS,
        sourceStart: 0,
        sourceEnd: SAMPLE_DURATION_SECONDS,
        videoEnabled: true,
        audioEnabled: true,
      },
    ],
    zoomClips: [],
    frame: {
      background: {
        type: 'solid',
        solidColor: '#141414',
        padding: 0.08,
        cornerRadius: 10,
        shadowBlur: 18,
        shadowOpacity: 0.28,
      },
    },
    export: { ...preset.export, outputFileName: `${id}.mp4` },
    expected: {
      audio: true,
      moving: true,
      durationToleranceSeconds: 0.5,
      minDistinctFrameHashes: 2,
    },
  };
}

/**
 * How to launch the app for the export harness. electron-forge start wants
 * an open stdin (it listens for "rs"); macOS and Linux get a PTY through
 * script(1), whose flags differ between BSD and util-linux.
 */
export function buildHarnessLaunch(platform) {
  if (platform === 'darwin') {
    return {
      command: '/bin/zsh',
      args: ['-lc', 'tail -f /dev/null | script -q /dev/null pnpm start'],
      shell: false,
    };
  }
  if (platform === 'win32') {
    return { command: 'pnpm', args: ['start'], shell: true };
  }
  return {
    command: '/bin/bash',
    args: ['-lc', 'tail -f /dev/null | script -qefc "pnpm start" /dev/null'],
    shell: false,
  };
}

/**
 * Where the release samples and their manifests are cached between runs.
 * Not the shared temp directory: there another local user could plant a
 * sample, or a symlink that a manifest write would follow.
 */
export function releaseCacheDir(root) {
  return path.join(root, 'node_modules', '.cache', 'screenforge-bench-export');
}

/**
 * The command that kills the harness process tree, or null where the
 * ps-based process-tree helper works. Windows has no ps, so taskkill /T is
 * the only way to reach Electron Forge and Electron behind the shell.
 */
export function buildTreeKillCommand(platform, pid) {
  if (platform !== 'win32') {
    return null;
  }
  return { command: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] };
}

/** One benchmark result row from the harness result file. */
export function summarizeHarnessResult(
  manifestName,
  manifest,
  result,
  outputSizeBytes,
  wallClockMs,
) {
  const seconds = result.elapsedMs / 1000;
  const contentSeconds = result.outputInfo?.duration ?? null;
  const budgetMs = manifest.expected?.maxElapsedMs ?? null;
  return {
    manifest: manifestName,
    id: manifest.id,
    seconds,
    contentSeconds,
    realtimeFactor:
      contentSeconds != null
        ? Number((contentSeconds / Math.max(seconds, 0.001)).toFixed(3))
        : null,
    budgetMs,
    overBudget: budgetMs != null && result.elapsedMs > budgetMs,
    captureFrameCount: result.captureFrameCount ?? null,
    outputWidth: result.outputInfo?.width ?? null,
    outputHeight: result.outputInfo?.height ?? null,
    outputFps: result.outputInfo?.fps ?? null,
    outputSizeBytes,
    capturePerf: result.capturePerf ?? null,
    wallClockMs,
  };
}

/** The JSON file written by `--json`: results plus the machine that produced them. */
export function buildBenchmarkReport({ environment, generatedAt, results }) {
  return { schemaVersion: 1, generatedAt, environment, results };
}

/** A row for the table in docs/EXPORT_BENCHMARKS.md. */
export function formatMarkdownRow(environment, result) {
  const preset = RELEASE_BENCHMARKS.find((entry) => `release-${entry.id}` === result.id);
  const realtime = result.realtimeFactor == null ? 'n/a' : `${result.realtimeFactor.toFixed(2)}x`;
  return [
    '',
    environment.appVersion,
    `${environment.platform} ${environment.arch}`,
    `${environment.cpuModel} (${environment.cpuCount} cores)`,
    preset?.label ?? result.id,
    `${result.seconds.toFixed(1)} s`,
    realtime,
    '',
  ]
    .join(' | ')
    .trim();
}
