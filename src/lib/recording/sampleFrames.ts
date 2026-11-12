import type { RgbaFrame } from '../window-bar';

export interface SampledFrames {
  frames: RgbaFrame[];
  /** The video's own size; the frames are scaled down to at most `maxWidth`. */
  videoWidth: number;
  videoHeight: number;
}

const SEEK_TIMEOUT_MS = 4000;

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
    for (const t of times) {
      try {
        const seeked = once(video, 'seeked', SEEK_TIMEOUT_MS);
        video.currentTime = Math.min(Math.max(0, t), Math.max(0, video.duration - 0.05));
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
