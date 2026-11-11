// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildH264EncodeArgs,
  buildSegmentConcatArgs,
  buildSegmentConcatList,
  buildWaylandTranscodeArgs,
  BT709_TAG_ARGS,
  RGB_TO_BT709_FILTER,
  buildX11GrabArgs,
  buildAppendClipFilter,
  clampCaptureBounds,
  computeAreaCropPixels,
  fitH264FrameSize,
} from './capture-args';

describe('fitH264FrameSize', () => {
  it('keeps sizes H.264 encoders accept, including 4K UHD', () => {
    expect(fitH264FrameSize(1920, 1080)).toEqual({ width: 1920, height: 1080, scaled: false });
    expect(fitH264FrameSize(3840, 2160)).toEqual({ width: 3840, height: 2160, scaled: false });
    expect(fitH264FrameSize(4096, 2304)).toEqual({ width: 4096, height: 2304, scaled: false });
  });

  it('scales a 5K frame down to the largest 16:9 size H.264 allows', () => {
    // VideoToolbox refused 5120x2880 when joining clips (Sentry SCREENFORGE-APP-7X).
    expect(fitH264FrameSize(5120, 2880)).toEqual({ width: 4096, height: 2304, scaled: true });
    expect(fitH264FrameSize(6016, 3384)).toEqual({ width: 4096, height: 2304, scaled: true });
  });

  it('keeps the aspect ratio and even sides for other shapes', () => {
    const portrait = fitH264FrameSize(2880, 5120);
    expect(portrait.scaled).toBe(true);
    expect(portrait.width * portrait.height).toBeLessThanOrEqual(4096 * 2304);
    expect(Math.max(portrait.width, portrait.height)).toBeLessThanOrEqual(4096);
    expect(portrait.width / portrait.height).toBeCloseTo(2880 / 5120, 2);

    const ultrawide = fitH264FrameSize(5120, 1440);
    expect(ultrawide.width).toBeLessThanOrEqual(4096);
    expect(ultrawide.width % 2).toBe(0);
    expect(ultrawide.height % 2).toBe(0);
    expect(ultrawide.width / ultrawide.height).toBeCloseTo(5120 / 1440, 2);
  });

  // The encoder rounds each side up to a 16px macroblock before checking its
  // 36,864-macroblock limit: OpenH264 rejected 3884x2428 as "3888 x 2432".
  const macroblocks = (w: number, h: number) => Math.ceil(w / 16) * Math.ceil(h / 16);

  it('fits a 16:10 5K frame within the macroblock limit', () => {
    const fit = fitH264FrameSize(5120, 3200);
    expect(fit.scaled).toBe(true);
    expect(macroblocks(fit.width, fit.height)).toBeLessThanOrEqual(36864);
    expect(fit.width / fit.height).toBeCloseTo(5120 / 3200, 2);
  });

  it('scales a size under the pixel area that is over the macroblock limit', () => {
    const fit = fitH264FrameSize(3884, 2428);
    expect(fit.scaled).toBe(true);
    expect(macroblocks(fit.width, fit.height)).toBeLessThanOrEqual(36864);
  });

  it('passes a size it cannot fit through unchanged instead of looping forever', () => {
    // A renderer-supplied crop area or a bad probe can be NaN, infinite, zero
    // or negative. A negative side with an oversized one (-2 x 5000) used to
    // hang the fitting loop.
    for (const [w, h] of [
      [NaN, 1080],
      [1920, NaN],
      [Infinity, 1080],
      [1920, -Infinity],
      [-2, 5000],
      [5000, -2],
      [0, 5000],
      [-5000, -5000],
    ]) {
      expect(fitH264FrameSize(w, h)).toEqual({ width: w, height: h, scaled: false });
    }
  });
});

describe('buildX11GrabArgs', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 };

  it('grabs the X11 display at 60fps without drawing the cursor', () => {
    const args = buildX11GrabArgs(bounds, ':0', '/tmp/out.mp4');

    expect(args).toEqual([
      '-f',
      'x11grab',
      '-draw_mouse',
      '0',
      '-framerate',
      '60',
      '-video_size',
      '1920x1080',
      '-i',
      ':0+0,0',
      '-c:v',
      'libopenh264',
      '-b:v',
      '20000k',
      '-vf',
      'scale=out_color_matrix=bt709:out_range=tv',
      '-pix_fmt',
      'yuv420p',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_range',
      'tv',
      '-y',
      '/tmp/out.mp4',
    ]);
  });

  it('converts with the BT.709 matrix and says so, matching how Chromium decodes it', () => {
    // swscale's default RGB->YUV matrix is BT.601 and leaves the file
    // untagged; Chromium (preview and export decode) reads untagged H.264 as
    // BT.709, which shifted reds and oranges (#d44523 came back as #e15224).
    const args = buildX11GrabArgs(bounds, ':0', '/tmp/out.mp4');
    expect(args[args.indexOf('-vf') + 1]).toBe(RGB_TO_BT709_FILTER);
    expect(args).toEqual(expect.arrayContaining(BT709_TAG_ARGS));
  });

  it('uses an LGPL-safe encoder (bundled Linux FFmpeg has no x264)', () => {
    const args = buildX11GrabArgs(bounds, ':0', '/tmp/out.mp4');
    expect(args[args.indexOf('-c:v') + 1]).toBe('libopenh264');
  });

  it('forces yuv420p so Chromium can decode the recording', () => {
    // x11grab feeds BGR0; the explicit conversion keeps the output as
    // baseline yuv420p, which the editor's <video> can always play.
    const args = buildX11GrabArgs(bounds, ':0', '/tmp/out.mp4');
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
  });

  it('encodes multi-monitor offsets into the input spec', () => {
    const args = buildX11GrabArgs(
      { x: 1920, y: -120, width: 2560, height: 1440 },
      ':1',
      '/tmp/o.mp4',
    );

    expect(args[args.indexOf('-i') + 1]).toBe(':1+1920,-120');
    expect(args[args.indexOf('-video_size') + 1]).toBe('2560x1440');
  });
});

describe('clampCaptureBounds', () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };

  it('passes through even-sized bounds fully inside the display', () => {
    const bounds = { x: 100, y: 50, width: 800, height: 600 };
    expect(clampCaptureBounds(bounds, display)).toEqual(bounds);
  });

  it('floors odd window sizes to even dimensions for yuv420p', () => {
    expect(clampCaptureBounds({ x: 10, y: 20, width: 801, height: 599 }, display)).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 598,
    });
  });

  it('clips a window hanging past the screen edge (x11grab rejects it)', () => {
    expect(clampCaptureBounds({ x: 1800, y: 900, width: 400, height: 400 }, display)).toEqual({
      x: 1800,
      y: 900,
      width: 120,
      height: 180,
    });
  });

  it('clips a window hanging past the top-left and keeps display-relative origin', () => {
    expect(clampCaptureBounds({ x: -100, y: -50, width: 500, height: 400 }, display)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 350,
    });
  });

  it('returns null for a window entirely off the display', () => {
    expect(clampCaptureBounds({ x: 2000, y: 0, width: 300, height: 300 }, display)).toBeNull();
  });

  it('returns null when the visible sliver is under 2px', () => {
    expect(clampCaptureBounds({ x: 1919, y: 0, width: 300, height: 300 }, display)).toBeNull();
  });

  it('handles secondary displays with non-zero origins', () => {
    const secondary = { x: 1920, y: -120, width: 2560, height: 1440 };
    expect(clampCaptureBounds({ x: 2000, y: 0, width: 640, height: 480 }, secondary)).toEqual({
      x: 2000,
      y: 0,
      width: 640,
      height: 480,
    });
  });
});

describe('buildH264EncodeArgs', () => {
  it('uses VideoToolbox on macOS', () => {
    expect(buildH264EncodeArgs('20000k', 'darwin')).toEqual([
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      '20000k',
    ]);
  });

  it('uses libopenh264 on Linux (LGPL bundle has no x264)', () => {
    expect(buildH264EncodeArgs('20000k', 'linux')).toEqual([
      '-c:v',
      'libopenh264',
      '-b:v',
      '20000k',
    ]);
  });

  it('falls back to libx264 on Windows', () => {
    expect(buildH264EncodeArgs('20000k', 'win32')).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-b:v',
      '20000k',
    ]);
  });
});

describe('buildWaylandTranscodeArgs', () => {
  it('transcodes portal webm to a seekable H.264 MP4 without audio', () => {
    const args = buildWaylandTranscodeArgs('/tmp/in.webm', '/tmp/out.mp4', 'linux');

    expect(args).toEqual([
      '-y',
      '-i',
      '/tmp/in.webm',
      '-vf',
      'format=yuv420p,setsar=1',
      '-c:v',
      'libopenh264',
      '-b:v',
      '20000k',
      '-an',
      '-movflags',
      '+faststart',
      '/tmp/out.mp4',
    ]);
  });

  it('places -i before the video filter and output last', () => {
    const args = buildWaylandTranscodeArgs('/a.webm', '/b.mp4', 'linux');
    expect(args.indexOf('-i')).toBeLessThan(args.indexOf('-vf'));
    expect(args[args.length - 1]).toBe('/b.mp4');
  });
});

describe('buildSegmentConcatList', () => {
  it('lists each segment in recording order for the concat demuxer', () => {
    expect(buildSegmentConcatList([{ path: '/tmp/a.mp4' }, { path: '/tmp/b.mp4' }])).toBe(
      "file '/tmp/a.mp4'\nfile '/tmp/b.mp4'\n",
    );
  });

  it('cuts a segment at its outpoint (the moment pause was pressed)', () => {
    expect(
      buildSegmentConcatList([{ path: '/tmp/a.mp4', outpointMs: 2500 }, { path: '/tmp/b.mp4' }]),
    ).toBe("file '/tmp/a.mp4'\noutpoint 2.500000\nfile '/tmp/b.mp4'\n");
  });

  it('rounds the outpoint down, so it never reaches into the next frame', () => {
    // Frame 178 at 60fps starts at 2.9666…s; rounding to 2.966667 would keep a
    // 1-tick sliver of it.
    expect(buildSegmentConcatList([{ path: '/tmp/a.mp4', outpointMs: (178 * 1000) / 60 }])).toBe(
      "file '/tmp/a.mp4'\noutpoint 2.966666\n",
    );
  });

  it("escapes single quotes so a path can't break out of its entry", () => {
    expect(buildSegmentConcatList([{ path: "/tmp/it's.mp4" }])).toBe("file '/tmp/it'\\''s.mp4'\n");
  });
});

describe('buildSegmentConcatArgs', () => {
  it('joins segments losslessly (stream copy, no re-encode) into a faststart MP4', () => {
    const args = buildSegmentConcatArgs('/tmp/list.txt', '/tmp/joined.mp4');

    expect(args).toEqual([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      '/tmp/list.txt',
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      '/tmp/joined.mp4',
    ]);
  });
});

describe('computeAreaCropPixels', () => {
  it('maps a Retina selection to exactly twice its logical size', () => {
    expect(
      computeAreaCropPixels(
        { x: 151, y: 98, width: 600, height: 401 },
        { width: 1512, height: 982 },
        { width: 3024, height: 1964 },
      ),
    ).toEqual({ x: 302, y: 196, width: 1200, height: 802 });
  });

  it('keeps odd sizes instead of rounding them to even', () => {
    expect(
      computeAreaCropPixels(
        { x: 7, y: 3, width: 641, height: 359 },
        { width: 1920, height: 1080 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 7, y: 3, width: 641, height: 359 });
  });

  it('rounds edges, not sizes, at fractional scales', () => {
    // 125% scaling: 101 → 126.25 and 701 → 876.25 logical px.
    const crop = computeAreaCropPixels(
      { x: 101, y: 51, width: 600, height: 400 },
      { width: 1536, height: 864 },
      { width: 1920, height: 1080 },
    );
    expect(crop).toEqual({ x: 126, y: 64, width: 750, height: 500 });
  });

  it('follows the video when it was recorded smaller than the display', () => {
    // A 5K display captured at 4096x2304: the same screen region, scaled.
    expect(
      computeAreaCropPixels(
        { x: 1280, y: 720, width: 1280, height: 720 },
        { width: 2560, height: 1440 },
        { width: 4096, height: 2304 },
      ),
    ).toEqual({ x: 2048, y: 1152, width: 2048, height: 1152 });
  });

  it('clamps an area that reaches past the edge of the video', () => {
    expect(
      computeAreaCropPixels(
        { x: 1800, y: 1000, width: 300, height: 200 },
        { width: 1920, height: 1080 },
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ x: 1800, y: 1000, width: 120, height: 80 });
  });
});

describe('buildAppendClipFilter', () => {
  it('keeps the existing fit-and-pad when nothing is cropped', () => {
    expect(buildAppendClipFilter({ width: 1920, height: 1080 })).toBe(
      'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p',
    );
  });

  it('crops the appended clip to its own selected area first', () => {
    expect(
      buildAppendClipFilter({
        width: 1920,
        height: 1080,
        sourceCrop: { x: 7, y: 3, width: 641, height: 359 },
      }),
    ).toBe(
      'crop=641:359:7:3:exact=1,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p',
    );
  });

  it('places the clip inside the project crop so it shows where the crop is', () => {
    expect(
      buildAppendClipFilter({
        width: 3024,
        height: 1964,
        sourceCrop: { x: 302, y: 196, width: 1200, height: 802 },
        target: { x: 151, y: 99, width: 1201, height: 803 },
      }),
    ).toBe(
      'crop=1200:802:302:196:exact=1,format=yuv444p,scale=1201:803:force_original_aspect_ratio=decrease,pad=1201:803:(ow-iw)/2:(oh-ih)/2,pad=3024:1964:151:99,setsar=1,format=yuv420p',
    );
  });
});
