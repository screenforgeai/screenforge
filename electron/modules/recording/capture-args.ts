/**
 * Pure FFmpeg argument builders for screen-capture and post-processing.
 * No Electron imports — kept separate from service.ts so the exact command
 * lines can be unit-tested (and exercised against a real display in CI).
 */

export type CaptureBounds = { x: number; y: number; width: number; height: number };

/**
 * Intersects capture bounds with a containing display and floors the size to
 * even numbers — yuv420p (and thus libopenh264) requires even dimensions, and
 * x11grab errors when the region extends past the screen edge. Returns null
 * when the intersection is empty or degenerate.
 */
export function clampCaptureBounds(
  bounds: CaptureBounds,
  container: CaptureBounds,
): CaptureBounds | null {
  const left = Math.max(bounds.x, container.x);
  const top = Math.max(bounds.y, container.y);
  const right = Math.min(bounds.x + bounds.width, container.x + container.width);
  const bottom = Math.min(bounds.y + bounds.height, container.y + container.height);
  const width = Math.floor((right - left) / 2) * 2;
  const height = Math.floor((bottom - top) / 2) * 2;

  if (width < 2 || height < 2) {
    return null;
  }

  return { x: left, y: top, width, height };
}

/**
 * RGB screen pixels → limited-range yuv420p using the BT.709 matrix.
 * FFmpeg's default is BT.601 and it doesn't tag the file, while Chromium —
 * the editor preview and the export's decoder — reads untagged H.264 as
 * BT.709, so reds, oranges and blues came out shifted in both.
 */
export const RGB_TO_BT709_FILTER = 'scale=out_color_matrix=bt709:out_range=tv';

/** Tags the stream as BT.709 limited range so every player decodes it the same way. */
export const BT709_TAG_ARGS = [
  '-colorspace',
  'bt709',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-color_range',
  'tv',
];

/**
 * Linux X11 display grab. `displayEnv` is the X11 DISPLAY string (e.g. ":0").
 * The cursor is not drawn — Screenforge renders its own cursor from the
 * uiohook event stream.
 */
export function buildX11GrabArgs(
  bounds: CaptureBounds,
  displayEnv: string,
  outPath: string,
): string[] {
  const { x, y, width, height } = bounds;

  return [
    '-f',
    'x11grab',
    '-draw_mouse',
    '0',
    '-framerate',
    '60',
    '-video_size',
    `${width}x${height}`,
    '-i',
    `${displayEnv}+${x},${y}`,
    // libopenh264, not libx264: the bundled Linux FFmpeg is an LGPL build
    // (scripts/download-ffmpeg-linux.sh), which excludes GPL x264.
    '-c:v',
    'libopenh264',
    '-b:v',
    '20000k',
    // x11grab feeds BGR0; openh264 only encodes yuv420p, so convert explicitly
    // (also keeps Chromium's <video> decoder happy), with the BT.709 matrix
    // Chromium decodes it with.
    '-vf',
    RGB_TO_BT709_FILTER,
    '-pix_fmt',
    'yuv420p',
    ...BT709_TAG_ARGS,
    '-y',
    outPath,
  ];
}

/**
 * A capture segment to join. `outpointMs` cuts it at the moment pause was
 * pressed, dropping what FFmpeg grabbed while it was shutting down.
 */
export type CaptureSegment = { path: string; outpointMs?: number };

/**
 * Concat-demuxer list joining capture segments (one per pause/resume) in
 * recording order. Single quotes are escaped the way the demuxer expects.
 * Outpoints are truncated to whole microseconds (never rounded up), so a cut
 * on a frame boundary can't keep a sliver of the following frame.
 */
export function buildSegmentConcatList(segments: CaptureSegment[]): string {
  return segments
    .map(({ path, outpointMs }) => {
      const entry = `file '${path.replace(/'/g, "'\\''")}'\n`;
      if (outpointMs === undefined) {
        return entry;
      }
      const outpointSeconds = Math.floor(outpointMs * 1000) / 1_000_000;
      return `${entry}outpoint ${outpointSeconds.toFixed(6)}\n`;
    })
    .join('');
}

/**
 * Joins capture segments without re-encoding. Every segment comes from the
 * same capture args, so stream copy is lossless and near-instant.
 */
export function buildSegmentConcatArgs(listPath: string, outPath: string): string[] {
  return [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    outPath,
  ];
}

/**
 * H.264 encoder args for post-processing (crop/concat/reencode/transcode).
 * macOS uses VideoToolbox; Linux uses libopenh264 (the bundled FFmpeg is an
 * LGPL build without x264); elsewhere fall back to libx264.
 */
export function buildH264EncodeArgs(bitrate: string, platform = process.platform): string[] {
  if (platform === 'darwin') {
    return ['-c:v', 'h264_videotoolbox', '-b:v', bitrate];
  }
  if (platform === 'linux') {
    return ['-c:v', 'libopenh264', '-b:v', bitrate];
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', bitrate];
}

// H.264 level 5.2: 36,864 macroblocks a frame (4096x2304), and VideoToolbox
// won't open wider than 4096. libopenh264 has the same ceiling. Encoders
// round each side up to a whole 16px macroblock before checking, so a frame
// under the pixel area can still be over (3884x2428 is 3888x2432 to them).
const H264_MAX_SIDE = 4096;
const H264_MAX_MACROBLOCKS = (4096 / 16) * (2304 / 16);

const fitsH264 = (width: number, height: number) =>
  width <= H264_MAX_SIDE &&
  height <= H264_MAX_SIDE &&
  Math.ceil(width / 16) * Math.ceil(height / 16) <= H264_MAX_MACROBLOCKS;

/**
 * The size to encode a width x height frame at with buildH264EncodeArgs: the
 * same size when the encoder accepts it, otherwise scaled down (aspect kept,
 * even sides) to fit. A 5K display records at 5120x2880, which VideoToolbox
 * refuses to encode.
 */
export function fitH264FrameSize(
  width: number,
  height: number,
): { width: number; height: number; scaled: boolean } {
  // Only positive, finite sizes can be fitted: a bad crop area or probe (NaN,
  // Infinity, zero or negative) passes through and FFmpeg rejects it as before.
  const fittable = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  if (!fittable || fitsH264(width, height)) {
    return { width, height, scaled: false };
  }
  let factor = Math.min(
    H264_MAX_SIDE / width,
    H264_MAX_SIDE / height,
    Math.sqrt((H264_MAX_MACROBLOCKS * 256) / (width * height)),
  );
  // The epsilon keeps exact fits (6016x3384 → 4096x2304) from rounding down.
  const even = (n: number) => Math.floor((n * factor) / 2 + 1e-6) * 2;
  // Macroblock rounding can tip an area-sized fit just over; shrink until it
  // fits. A few steps always do; the cap only guarantees the loop ends.
  for (let step = 0; step < 1000 && !fitsH264(even(width), even(height)); step++) {
    factor *= 0.995;
  }
  return { width: even(width), height: even(height), scaled: true };
}

/**
 * The exact video pixels of an area selected on a display. The area is in the
 * display's logical pixels; the video is the whole display at whatever size it
 * was captured (2x on Retina, 1.25x at 125% scaling, smaller for a 5K screen
 * capped to what the encoder takes). Edges are rounded rather than sizes, so a
 * 600 px selection at 1.25x is 750 px wherever it starts. Odd sizes stay odd:
 * the editor crops this rect, and only export rounds to even.
 */
export function computeAreaCropPixels(
  area: CaptureBounds,
  display: { width: number; height: number },
  video: { width: number; height: number },
): CaptureBounds {
  const scaleX = video.width / display.width;
  const scaleY = video.height / display.height;
  const edge = (value: number, scale: number, max: number) =>
    Math.min(max, Math.max(0, Math.round(value * scale)));

  const left = edge(area.x, scaleX, video.width);
  const top = edge(area.y, scaleY, video.height);
  const right = edge(area.x + area.width, scaleX, video.width);
  const bottom = edge(area.y + area.height, scaleY, video.height);

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The filter that fits an appended clip into a width x height join. A clip
 * recorded from an area is first cut to that area (`exact` keeps odd offsets
 * exact). With a `target` — the project's crop, in the join's pixels — the clip
 * is fitted into that rect and placed where it is, so it fills the cropped
 * picture the way it would have filled a pre-cropped file.
 */
export function buildAppendClipFilter(options: {
  width: number;
  height: number;
  sourceCrop?: CaptureBounds;
  target?: CaptureBounds;
}): string {
  const { width, height, sourceCrop, target } = options;
  const crop = sourceCrop
    ? [`crop=${sourceCrop.width}:${sourceCrop.height}:${sourceCrop.x}:${sourceCrop.y}:exact=1`]
    : [];
  const fitInto = (w: number, h: number) => [
    `scale=${w}:${h}:force_original_aspect_ratio=decrease`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
  ];

  const isFullTarget =
    !target ||
    (target.x === 0 && target.y === 0 && target.width === width && target.height === height);
  const place = isFullTarget
    ? fitInto(width, height)
    : [
        // 4:4:4 while placing, so odd offsets and sizes aren't rounded to the
        // 4:2:0 chroma grid; the join converts back below.
        'format=yuv444p',
        ...fitInto(target.width, target.height),
        `pad=${width}:${height}:${target.x}:${target.y}`,
      ];

  return [...crop, ...place, 'setsar=1', 'format=yuv420p'].join(',');
}

/**
 * Wayland (Linux): transcodes the renderer-captured portal webm (VP9/VP8 from
 * MediaRecorder) into the H.264 MP4 the rest of the pipeline expects.
 * The portal stream carries no audio — mic is a separate track merged later.
 */
export function buildWaylandTranscodeArgs(
  webmPath: string,
  outPath: string,
  platform = process.platform,
): string[] {
  return [
    '-y',
    '-i',
    webmPath,
    '-vf',
    'format=yuv420p,setsar=1',
    ...buildH264EncodeArgs('20000k', platform),
    '-an',
    '-movflags',
    '+faststart',
    outPath,
  ];
}
