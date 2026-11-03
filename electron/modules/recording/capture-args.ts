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
    // (also keeps Chromium's <video> decoder happy).
    '-pix_fmt',
    'yuv420p',
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
