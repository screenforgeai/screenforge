import { useEffect, useState } from 'react';
import { createScreenforgeFileUrl } from 'src/lib/screenforge-url';

const FRAME_WIDTH = 480;
const GRAB_TIMEOUT_MS = 8000;
const cache = new Map<string, Promise<string | null>>();

/** Decodes one frame of a recording to a small JPEG, once per path and time. */
function grabFrame(videoPath: string, time: number): Promise<string | null> {
  const key = `${videoPath}@${time.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const promise = new Promise<string | null>((resolve) => {
    const video = document.createElement('video');
    let settled = false;
    const done = (url: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      video.removeAttribute('src');
      video.load();
      // A failed grab (say, a recording still being written) is retried next time.
      if (!url) {
        cache.delete(key);
      }
      resolve(url);
    };
    const timeout = window.setTimeout(() => done(null), GRAB_TIMEOUT_MS);
    video.muted = true;
    video.preload = 'auto';
    // Without CORS the canvas is tainted and toDataURL throws.
    video.crossOrigin = 'anonymous';
    video.onerror = () => done(null);
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(time, Math.max(0, video.duration - 0.05));
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = FRAME_WIDTH;
      canvas.height = Math.round((FRAME_WIDTH * video.videoHeight) / Math.max(1, video.videoWidth));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        done(null);
        return;
      }
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        done(canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        done(null);
      }
    };
    video.src = createScreenforgeFileUrl(videoPath);
  });
  cache.set(key, promise);
  return promise;
}

/**
 * A still of the user's recording for previews. Decoded once and shared, so
 * opening previews and moving between options never creates a video decoder.
 */
export function useRecordingFrame(videoPath: string | null, time: number): string | null {
  const key = videoPath ? `${videoPath}@${time.toFixed(2)}` : null;
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!videoPath || !key) {
      return;
    }
    let alive = true;
    void grabFrame(videoPath, time).then((url) => {
      if (alive) {
        setLoaded({ key, url });
      }
    });
    return () => {
      alive = false;
    };
  }, [videoPath, time, key]);
  return loaded && loaded.key === key ? loaded.url : null;
}
