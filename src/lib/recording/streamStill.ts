import type { AreaSelectorStillRequest } from '../../types/index';

/** How long to wait for the shared screen's first picture. */
const STILL_TIMEOUT_MS = 5000;

/**
 * The frame a live screen stream is showing now, as PNG bytes in the stream's own pixels.
 * Wayland: the area to record is drawn on it, since a selector over the live screen may land
 * on any monitor. Fails, rather than waiting forever, when the share ends or sends no picture.
 */
export async function grabStreamStill(stream: MediaStream): Promise<AreaSelectorStillRequest> {
  const [track] = stream.getVideoTracks();
  if (!track || track.readyState === 'ended') {
    throw new Error('Sharing stopped before the screen could be shown.');
  }
  const video = document.createElement('video');
  let onEnded: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const gaveUp = new Promise<never>((_, reject) => {
      onEnded = () => reject(new Error('Sharing stopped before the screen could be shown.'));
      track.addEventListener('ended', onEnded);
      timer = setTimeout(
        () => reject(new Error('The shared screen sent no picture.')),
        STILL_TIMEOUT_MS,
      );
    });
    return await Promise.race([drawFrame(video, stream), gaveUp]);
  } finally {
    if (onEnded) {
      track.removeEventListener('ended', onEnded);
    }
    clearTimeout(timer);
    video.pause();
    video.srcObject = null;
  }
}

async function drawFrame(
  video: HTMLVideoElement,
  stream: MediaStream,
): Promise<AreaSelectorStillRequest> {
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  // The first frame can arrive after playback starts.
  if (video.videoWidth === 0 && 'requestVideoFrameCallback' in video) {
    await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
  }
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new Error('The shared screen sent no picture.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('Could not take a picture of the shared screen.');
  }
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
}
