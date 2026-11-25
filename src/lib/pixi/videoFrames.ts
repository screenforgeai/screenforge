export interface VideoFrameTracker {
  /** Changes whenever the video shows a new frame; undefined when it can't be told. */
  readonly frameId: number | undefined;
  dispose: () => void;
}

// Shared by every tracker, so a frame id never repeats across videos or recordings.
let lastFrameId = 0;

/**
 * Tells when a video shows a new frame: each played frame (requestVideoFrameCallback),
 * plus seeks and loads, which while paused show a new frame without one. Without
 * requestVideoFrameCallback the frame id stays undefined, which means "always new".
 */
export function trackVideoFrames(video: HTMLVideoElement, onFrame?: () => void): VideoFrameTracker {
  if (typeof video.requestVideoFrameCallback !== 'function') {
    return { frameId: undefined, dispose: () => undefined };
  }

  let frameId = ++lastFrameId;
  let disposed = false;
  const bump = (): void => {
    frameId = ++lastFrameId;
    onFrame?.();
  };
  const onVideoFrame = (): void => {
    if (disposed) {
      return;
    }
    bump();
    handle = video.requestVideoFrameCallback(onVideoFrame);
  };
  let handle = video.requestVideoFrameCallback(onVideoFrame);
  video.addEventListener('seeked', bump);
  video.addEventListener('loadeddata', bump);

  return {
    get frameId() {
      return frameId;
    },
    dispose: () => {
      disposed = true;
      video.cancelVideoFrameCallback?.(handle);
      video.removeEventListener('seeked', bump);
      video.removeEventListener('loadeddata', bump);
    },
  };
}
