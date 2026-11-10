// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  RELEASE_BENCHMARKS,
  buildBenchmarkReport,
  buildHarnessLaunch,
  buildSampleMediaArgs,
  buildTreeKillCommand,
  releaseCacheDir,
  formatMarkdownRow,
  pickSampleEncoder,
  resolveBenchmarkManifest,
  summarizeHarnessResult,
} from './bench-export-lib.mjs';

describe('RELEASE_BENCHMARKS', () => {
  it('covers the 1080p and 4K exports with the default export settings', () => {
    expect(RELEASE_BENCHMARKS.map((preset: { id: string }) => preset.id)).toEqual(['1080p', '4k']);
    for (const preset of RELEASE_BENCHMARKS) {
      expect(preset.export).toMatchObject({ format: 'mp4', fps: 60, quality: 'high' });
    }
    expect(RELEASE_BENCHMARKS[0]).toMatchObject({ width: 1920, height: 1080 });
    expect(RELEASE_BENCHMARKS[1]).toMatchObject({ width: 3840, height: 2160 });
  });
});

describe('pickSampleEncoder', () => {
  it('prefers libx264, then the encoders each platform ships', () => {
    expect(pickSampleEncoder(' V....D libx264  H.264\n V..... libopenh264 x')).toBe('libx264');
    expect(pickSampleEncoder(' V....D libopenh264 OpenH264')).toBe('libopenh264');
    expect(pickSampleEncoder(' V....D h264_videotoolbox VT')).toBe('h264_videotoolbox');
    expect(pickSampleEncoder(' V....D h264_mf MediaFoundation')).toBe('h264_mf');
    expect(pickSampleEncoder(' V....D mpeg4 MPEG-4')).toBeNull();
  });
});

describe('buildSampleMediaArgs', () => {
  it('renders a fixed synthetic screen with a tone at the preset size', () => {
    const args = buildSampleMediaArgs(RELEASE_BENCHMARKS[1], 'libx264', '/tmp/sample.mp4');

    expect(args).toContain('testsrc2=size=3840x2160:rate=60:duration=20');
    expect(args).toContain('sine=frequency=440:sample_rate=48000:duration=20');
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-pix_fmt', 'yuv420p']));
    expect(args).toEqual(expect.arrayContaining(['-c:a', 'aac']));
    expect(args.at(-1)).toBe('/tmp/sample.mp4');
  });
});

describe('resolveBenchmarkManifest', () => {
  it('points the manifest at the generated sample and names the output by preset', () => {
    const manifest = resolveBenchmarkManifest(RELEASE_BENCHMARKS[0], '/cache/bench-1080p.mp4');

    expect(manifest.id).toBe('release-1080p');
    expect(manifest.recording.filePath).toBe('/cache/bench-1080p.mp4');
    expect(manifest.recording.recordingArea).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(manifest.export).toMatchObject({
      resolution: '1080p',
      includeAudio: true,
      outputFileName: 'release-1080p.mp4',
    });
    expect(manifest.mediaSegments[0]).toMatchObject({ sourceEnd: 20, audioEnabled: true });
  });
});

describe('buildHarnessLaunch', () => {
  it('uses BSD script(1) through zsh on macOS', () => {
    expect(buildHarnessLaunch('darwin')).toEqual({
      command: '/bin/zsh',
      args: ['-lc', 'tail -f /dev/null | script -q /dev/null pnpm start'],
      shell: false,
    });
  });

  it('uses util-linux script(1) through bash on Linux (zsh is not installed by default)', () => {
    expect(buildHarnessLaunch('linux')).toEqual({
      command: '/bin/bash',
      args: ['-lc', 'tail -f /dev/null | script -qefc "pnpm start" /dev/null'],
      shell: false,
    });
  });

  it('runs pnpm through the shell on Windows, where there is no script(1)', () => {
    expect(buildHarnessLaunch('win32')).toEqual({ command: 'pnpm', args: ['start'], shell: true });
  });
});

describe('buildTreeKillCommand', () => {
  it('kills the whole harness tree with taskkill on Windows, where ps is unavailable', () => {
    expect(buildTreeKillCommand('win32', 4242)).toEqual({
      command: 'taskkill',
      args: ['/pid', '4242', '/T', '/F'],
    });
  });

  it('leaves macOS and Linux to the ps-based process-tree helper', () => {
    expect(buildTreeKillCommand('darwin', 4242)).toBeNull();
    expect(buildTreeKillCommand('linux', 4242)).toBeNull();
  });
});

describe('releaseCacheDir', () => {
  it("keeps the release samples in the repo's own cache, not the shared temp directory", () => {
    expect(releaseCacheDir('/work/screenforge')).toBe(
      '/work/screenforge/node_modules/.cache/screenforge-bench-export',
    );
  });
});

describe('summarizeHarnessResult', () => {
  it('reports seconds and the realtime factor for the exported content', () => {
    const summary = summarizeHarnessResult(
      'release-4k.json',
      { id: 'release-4k', expected: {} },
      {
        elapsedMs: 50_000,
        captureFrameCount: 1200,
        outputInfo: { width: 3840, height: 2160, fps: 60, duration: 20 },
      },
      123_456,
      12_000,
    );

    expect(summary).toMatchObject({
      manifest: 'release-4k.json',
      id: 'release-4k',
      seconds: 50,
      contentSeconds: 20,
      realtimeFactor: 0.4,
      outputWidth: 3840,
      outputHeight: 2160,
      outputFps: 60,
      outputSizeBytes: 123_456,
      overBudget: false,
    });
  });
});

describe('buildBenchmarkReport', () => {
  const environment = {
    appVersion: '0.7.0',
    gitCommit: 'abc1234',
    platform: 'linux',
    arch: 'x64',
    osRelease: '6.8.0',
    cpuModel: 'Test CPU',
    cpuCount: 8,
    totalMemoryGb: 16,
    nodeVersion: 'v22.0.0',
    ffmpegVersion: 'ffmpeg version 7.1',
  };

  it('wraps results with the machine they were measured on', () => {
    const report = buildBenchmarkReport({
      environment,
      generatedAt: '2026-11-06T00:00:00.000Z',
      results: [{ id: 'release-1080p', seconds: 10 }],
    });

    expect(report).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-11-06T00:00:00.000Z',
      environment,
      results: [{ id: 'release-1080p', seconds: 10 }],
    });
  });

  it('formats a docs table row', () => {
    const row = formatMarkdownRow(environment, {
      id: 'release-4k',
      seconds: 50,
      realtimeFactor: 0.4,
    });
    expect(row).toBe('| 0.7.0 | linux x64 | Test CPU (8 cores) | 4K | 50.0 s | 0.40x |');
  });
});
