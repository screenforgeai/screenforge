/**
 * The frame a live screen stream is showing now, as PNG bytes in the stream's own pixels.
 * Wayland: the area to record is drawn on it, since a selector over the live screen may land
 * on any monitor.
 */
export async function grabStreamStill(
  stream: MediaStream,
): Promise<{ png: Uint8Array; width: number; height: number }> {
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  try {
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
  } finally {
    video.pause();
    video.srcObject = null;
  }
}
