import type { RgbaFrame } from '../window-bar';

export interface SampledFrames {
  frames: RgbaFrame[];
  /** The video's own size; the frames are scaled down to at most `maxWidth`. */
  videoWidth: number;
  videoHeight: number;
}

const SEEK_TIMEOUT_MS = 4000;

/**
 * The positions to seek to for `times` in a video `duration` seconds long:
 * clamped to the video, and each one only once. A video shorter than the
 * recording said would otherwise give the same last frame many times over,
 * and repeats must not count as frames that held still.
 */
export function distinctSeekTimes(times: number[], duration: number): number[] {
  const end = Number.isFinite(duration) ? Math.max(0, duration - 0.05) : Infinity;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const t of times) {
    const at = Math.min(Math.max(0, t), end);
    // Whole milliseconds: closer seeks than that land on the same frame.
    const key = Math.round(at * 1000);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(at);
    }
  }
  return out;
}

function once(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(event, done);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      target.removeEventListener(event, done);
      resolve();
    };
    target.addEventListener(event, done);
  });
}

/**
 * Decodes the video at `times` (seconds) into RGBA frames, scaled to at most
 * `maxWidth` wide: enough rows to find a toolbar's edge without reading a
 * 5K recording in full. Frames that fail to decode are skipped.
 */
export async function sampleVideoFrames(
  url: string,
  times: number[],
  maxWidth = 960,
): Promise<SampledFrames> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await once(video, 'loadeddata', 15000);
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    const width = Math.max(1, Math.min(maxWidth, videoWidth));
    const height = Math.max(1, Math.round((videoHeight * width) / Math.max(videoWidth, 1)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { frames: [], videoWidth, videoHeight };
    }
    const frames: RgbaFrame[] = [];
    for (const t of distinctSeekTimes(times, video.duration)) {
      try {
        const seeked = once(video, 'seeked', SEEK_TIMEOUT_MS);
        video.currentTime = t;
        await seeked;
        ctx.drawImage(video, 0, 0, width, height);
        frames.push({ data: ctx.getImageData(0, 0, width, height).data, width, height });
      } catch {
        // A frame that won't decode just isn't counted.
      }
    }
    return { frames, videoWidth, videoHeight };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
