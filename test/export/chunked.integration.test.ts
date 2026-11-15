/**
 * Chunked export end to end, through the real app:
 *
 * 1. a chunked export renders every chunk and matches a single-pass export;
 * 2. exporting again unchanged renders nothing and gives identical frames;
 * 3. after an edit only the affected chunks render again, the reused chunks
 *    are bit-identical, and the result matches a fresh single-pass export of
 *    the edited project — including the frames right after each re-rendered
 *    chunk starts, where cursor and zoom warm-up has to be right.
 *
 * The project has the effects that carry state from frame to frame: a moving
 * cursor with motion blur, clicks with ripples, idle hiding across a chunk
 * boundary, and zoom clips.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  ExportFixtureManifest,
  ExportHarnessResult,
} from '../../electron/testing/exportHarnessManifest';
import { resolveTestFFmpegPath } from './ffmpegPath';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const processTree = require('../../shared/process-tree.js');

const ROOT = path.resolve(__dirname, '../..');
const MEDIA = path.join(ROOT, 'test/fixtures/export/media/screen-motion-20s.mp4');
const HARNESS_TIMEOUT_MS = 240_000;
const FPS = 30;
const DURATION = 20;
const WIDTH = 640;
const HEIGHT = 360;
// Two runs of the unchanged app differ by 47–64 dB on these fixtures.
const MIN_FRAME_PSNR = 40;

let ffmpegPath = 'ffmpeg';
let workDir = '';
let cacheDir = '';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, out }));
  });
}

function buildManifest(id: string, zoomScale: number): ExportFixtureManifest {
  const startTime = 1_700_000_000_000;
  const mouseData: ExportFixtureManifest['recording']['mouseData'] = [];
  for (let ms = 0; ms <= DURATION * 1000; ms += 33) {
    // The cursor rests from 7 s to 10.5 s, so idle hiding (2 s) kicks in
    // and ends across the chunk boundary at 8 s and 10 s.
    if (ms > 7000 && ms < 10_500) {
      continue;
    }
    const t = ms / 1000;
    mouseData.push({
      type: 'move',
      x: Math.round(WIDTH * (0.5 + 0.4 * Math.sin(t * 1.3))),
      y: Math.round(HEIGHT * (0.5 + 0.35 * Math.sin(t * 2.1 + 1))),
      timestamp: startTime + ms,
    });
  }
  // Clicks near chunk boundaries (every 2 s), so ripples cross them.
  for (const t of [1.9, 3.95, 5.9, 11.9, 13.97, 15.9, 17.95]) {
    const x = Math.round(WIDTH * (0.5 + 0.4 * Math.sin(t * 1.3)));
    const y = Math.round(HEIGHT * (0.5 + 0.35 * Math.sin(t * 2.1 + 1)));
    mouseData.push({ type: 'mousedown', x, y, timestamp: startTime + t * 1000 });
    mouseData.push({ type: 'mouseup', x, y, timestamp: startTime + t * 1000 + 120 });
  }
  mouseData.sort((a, b) => a.timestamp - b.timestamp);

  return {
    id,
    description: 'chunked export',
    recording: {
      filePath: MEDIA,
      mouseData,
      duration: DURATION,
      startTime,
      recordingArea: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    } as ExportFixtureManifest['recording'],
    mediaSegments: [
      {
        id: 'screen',
        timelineStart: 0,
        timelineEnd: DURATION,
        sourceStart: 0,
        sourceEnd: DURATION,
        videoEnabled: true,
        audioEnabled: false,
      },
    ],
    zoomClips: [
      {
        id: 'z1',
        start: 2.5,
        end: 6.5,
        scale: 2,
        cx: 0.5,
        cy: 0.5,
        easeIn: 0.6,
        easeOut: 0.8,
        mode: 'auto',
      },
      {
        id: 'z2',
        start: 12.2,
        end: 16.4,
        scale: zoomScale,
        cx: 0.5,
        cy: 0.5,
        easeIn: 0.6,
        easeOut: 0.8,
        mode: 'auto',
      },
    ] as ExportFixtureManifest['zoomClips'],
    frame: {
      background: { type: 'solid', solidColor: '#151515', padding: 0.08, cornerRadius: 10 },
    },
    cursor: {
      clickEffect: 'ripple',
      motionBlur: true,
      hideWhenIdle: true,
      idleHideSeconds: 2,
      halflife: 0.06,
    },
    export: {
      quality: 'high',
      format: 'mp4',
      resolution: '720p',
      fps: FPS,
      includeAudio: false,
      audioBitrateKbps: 128,
      outputFileName: `${id}.mp4`,
    },
    expected: {
      audio: false,
      moving: true,
      durationToleranceSeconds: 0.5,
      minDistinctFrameHashes: 2,
    },
  } as ExportFixtureManifest;
}

async function exportThroughApp(
  manifest: ExportFixtureManifest,
  chunked: boolean,
  options: { prerender?: boolean; cache?: string } = {},
): Promise<ExportHarnessResult & { outputPath: string }> {
  const dir = await fs.mkdtemp(path.join(workDir, `${manifest.id}-`));
  const manifestPath = path.join(dir, 'manifest.json');
  const resultPath = path.join(dir, 'result.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));

  const { buildHarnessLaunch } = (await import('../../scripts/bench-export-lib.mjs')) as {
    buildHarnessLaunch: (platform: string) => { command: string; args: string[]; shell: boolean };
  };
  const launch = buildHarnessLaunch(process.platform);
  const child = spawn(launch.command, launch.args, {
    cwd: ROOT,
    env: {
      ...process.env,
      CI: '1',
      SCREENFORGE_EXPORT_TEST_MANIFEST: manifestPath,
      SCREENFORGE_EXPORT_TEST_RESULT: resultPath,
      SCREENFORGE_EXPORT_CHUNKED: chunked ? '1' : '0',
      SCREENFORGE_EXPORT_CACHE_DIR: options.cache ?? cacheDir,
      SCREENFORGE_EXPORT_PRERENDER: options.prerender ? '1' : '0',
    },
    detached: process.platform !== 'win32',
    shell: launch.shell,
    stdio: [process.platform === 'win32' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (d: Buffer) => (log += d.toString()));
  child.stderr?.on('data', (d: Buffer) => (log += d.toString()));
  const closed = new Promise((resolve) => child.once('close', resolve));

  try {
    const deadline = Date.now() + HARNESS_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const result = JSON.parse(await fs.readFile(resultPath, 'utf8')) as ExportHarnessResult;
        if (result.success && result.outputPath) {
          return result as ExportHarnessResult & { outputPath: string };
        }
        if (result.error !== 'Harness started') {
          throw new Error(`Export failed: ${result.error}\n${log.slice(-4000)}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Export failed')) {
          throw error;
        }
      }
      await delay(250);
    }
    throw new Error(`Export timed out\n${log.slice(-4000)}`);
  } finally {
    if (child.pid) {
      await processTree.terminateProcessTree(child.pid).catch(() => undefined);
    }
    await Promise.race([closed, delay(5000)]);
  }
}

async function frameHashes(file: string): Promise<string[]> {
  const { out } = await run(ffmpegPath, [
    '-v',
    'error',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-f',
    'framemd5',
    '-',
  ]);
  return out
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').at(-1)?.trim() ?? '');
}

async function framePsnr(a: string, b: string): Promise<number[]> {
  const stats = path.join(workDir, `psnr-${Date.now()}-${Math.random()}.log`);
  await run(ffmpegPath, [
    '-v',
    'error',
    '-i',
    a,
    '-i',
    b,
    '-lavfi',
    `[0:v][1:v]psnr=stats_file='${stats.replace(/\\/g, '/').replace(/:/g, '\\:')}'`,
    '-f',
    'null',
    '-',
  ]);
  const text = await fs.readFile(stats, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const value = line.match(/psnr_avg:(\S+)/)?.[1] ?? '0';
      return value === 'inf' ? Infinity : Number(value);
    });
}

describe.sequential('chunked export', () => {
  beforeAll(async () => {
    ffmpegPath = await resolveTestFFmpegPath();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenforge-chunked-'));
    cacheDir = path.join(workDir, 'cache');
  });

  const base = buildManifest('chunked-base', 2);
  const edited = buildManifest('chunked-edited', 2.8);
  const outputs: Record<string, string> = {};
  const totalChunks = Math.ceil((DURATION * FPS) / (FPS * 2));

  it(
    'renders every chunk on a cold cache and matches a single pass',
    async () => {
      outputs.single = (await exportThroughApp(base, false)).outputPath;
      const cold = await exportThroughApp(base, true);
      outputs.cold = cold.outputPath;
      expect(cold.chunkStats).toEqual({ total: totalChunks, rendered: totalChunks });

      const single = await frameHashes(outputs.single);
      const chunked = await frameHashes(outputs.cold);
      expect(chunked).toHaveLength(single.length);
      expect(chunked).toHaveLength(DURATION * FPS);
      const psnr = await framePsnr(outputs.single, outputs.cold);
      expect(Math.min(...psnr)).toBeGreaterThanOrEqual(MIN_FRAME_PSNR);
    },
    HARNESS_TIMEOUT_MS * 3,
  );

  it(
    'renders nothing when exported again and gives identical frames',
    async () => {
      const warm = await exportThroughApp(base, true);
      expect(warm.chunkStats).toEqual({ total: totalChunks, rendered: 0 });
      expect(await frameHashes(warm.outputPath)).toEqual(await frameHashes(outputs.cold));
    },
    HARNESS_TIMEOUT_MS * 2,
  );

  it(
    'after an edit renders only nearby chunks and matches a fresh single pass',
    async () => {
      const partial = await exportThroughApp(edited, true);
      const rendered = partial.chunkStats?.rendered ?? -1;
      expect(rendered).toBeGreaterThan(0);
      expect(rendered).toBeLessThan(totalChunks);

      const fresh = await exportThroughApp(edited, false);
      const psnr = await framePsnr(fresh.outputPath, partial.outputPath);
      expect(psnr).toHaveLength(DURATION * FPS);
      expect(Math.min(...psnr)).toBeGreaterThanOrEqual(MIN_FRAME_PSNR);

      // Chunks before the edited zoom's window were reused untouched.
      const before = await frameHashes(outputs.cold);
      const after = await frameHashes(partial.outputPath);
      expect(after.slice(0, 2 * FPS)).toEqual(before.slice(0, 2 * FPS));
    },
    HARNESS_TIMEOUT_MS * 3,
  );

  it(
    'a background pre-render fills the cache so the export renders nothing',
    async () => {
      const result = await exportThroughApp(base, true, {
        prerender: true,
        cache: path.join(workDir, 'prerender-cache'),
      });
      expect(result.prerendered).toBe(true);
      expect(result.chunkStats).toEqual({ total: totalChunks, rendered: 0 });
      const psnr = await framePsnr(outputs.single, result.outputPath);
      expect(Math.min(...psnr)).toBeGreaterThanOrEqual(MIN_FRAME_PSNR);
    },
    HARNESS_TIMEOUT_MS * 2,
  );
});
