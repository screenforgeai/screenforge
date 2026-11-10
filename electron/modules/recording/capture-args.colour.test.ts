// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { RGB_TO_BT709_FILTER } from './capture-args';

const FFMPEG = process.env.SCREENFORGE_FFMPEG_PATH?.trim() || 'ffmpeg';
const hasFFmpeg = spawnSync(FFMPEG, ['-version']).status === 0;
if (!hasFFmpeg && process.env.SCREENFORGE_FFMPEG_PATH?.trim()) {
  console.warn(`SCREENFORGE_FFMPEG_PATH is set but ${FFMPEG} did not run; skipping colour tests.`);
}

// sRGB colours a screen recording has to keep: the brand orange, primaries, grey.
const SWATCHES: Array<[number, number, number]> = [
  [212, 69, 35],
  [255, 0, 0],
  [0, 0, 255],
  [128, 128, 128],
];

function bgr0Frame(): Buffer {
  // 16x16 per swatch so 4:2:0 chroma never mixes neighbouring colours.
  const width = SWATCHES.length * 16;
  const frame = Buffer.alloc(width * 16 * 4);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = SWATCHES[Math.floor(x / 16)];
      frame.set([b, g, r, 0], (y * width + x) * 4);
    }
  }
  return frame;
}

function run(args: string[], input: Buffer): Buffer {
  const result = spawnSync(FFMPEG, ['-v', 'error', ...args], { input, maxBuffer: 1 << 24 });
  if (result.status !== 0) {
    throw new Error(result.stderr.toString());
  }
  return result.stdout;
}

/** BGR0 (what x11grab produces) → yuv420p with the given filter, then decoded as BT.709 the way Chromium reads it. */
function roundTrip(captureFilter: string | null): Array<[number, number, number]> {
  const width = SWATCHES.length * 16;
  const raw = ['-f', 'rawvideo', '-pix_fmt', 'bgr0', '-s', `${width}x16`, '-i', 'pipe:0'];
  const yuv = run(
    [
      ...raw,
      ...(captureFilter ? ['-vf', captureFilter] : []),
      '-pix_fmt',
      'yuv420p',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    bgr0Frame(),
  );
  const rgb = run(
    [
      '-f',
      'rawvideo',
      '-pix_fmt',
      'yuv420p',
      '-s',
      `${width}x16`,
      '-i',
      'pipe:0',
      '-vf',
      'scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      'pipe:1',
    ],
    yuv,
  );
  return SWATCHES.map((_, index) => {
    const offset = (8 * width + index * 16 + 8) * 3;
    return [rgb[offset], rgb[offset + 1], rgb[offset + 2]];
  });
}

const maxChannelError = (decoded: Array<[number, number, number]>) =>
  Math.max(
    ...decoded.flatMap((pixel, index) =>
      pixel.map((value, channel) => Math.abs(value - SWATCHES[index][channel])),
    ),
  );

describe.skipIf(!hasFFmpeg)('X11 capture colour conversion (real FFmpeg)', () => {
  it('keeps on-screen colours when decoded as BT.709', () => {
    expect(maxChannelError(roundTrip(RGB_TO_BT709_FILTER))).toBeLessThanOrEqual(3);
  });

  it("shifts colours with FFmpeg's default BT.601 conversion (the old behaviour)", () => {
    expect(maxChannelError(roundTrip(null))).toBeGreaterThan(10);
  });
});
