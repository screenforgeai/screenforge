import { describe, expect, it, vi } from 'vitest';
import { trackVideoFrames } from './videoFrames';

const videoWithFrameCallbacks = () => {
  const video = document.createElement('video');
  const callbacks: VideoFrameRequestCallback[] = [];
  video.requestVideoFrameCallback = vi.fn((cb: VideoFrameRequestCallback) => {
    callbacks.push(cb);
    return callbacks.length;
  });
  video.cancelVideoFrameCallback = vi.fn();
  const presentFrame = () => {
    const cb = callbacks.shift();
    cb?.(performance.now(), {} as VideoFrameCallbackMetadata);
  };
  return { video, presentFrame };
};

describe('video frame tracking', () => {
  it('names a new frame for each played frame, seek and load', () => {
    const { video, presentFrame } = videoWithFrameCallbacks();
    const onFrame = vi.fn();
    const tracker = trackVideoFrames(video, onFrame);
    const seen = new Set([tracker.frameId]);

    presentFrame();
    seen.add(tracker.frameId);
    // A seek while paused shows a new frame without a video frame callback.
    video.dispatchEvent(new Event('seeked'));
    seen.add(tracker.frameId);
    video.dispatchEvent(new Event('loadeddata'));
    seen.add(tracker.frameId);

    expect(seen.size).toBe(4);
    expect(onFrame).toHaveBeenCalledTimes(3);
    tracker.dispose();
  });

  it('keeps the same frame id while nothing new is shown', () => {
    const { video } = videoWithFrameCallbacks();
    const tracker = trackVideoFrames(video);
    const first = tracker.frameId;
    video.dispatchEvent(new Event('timeupdate'));
    expect(tracker.frameId).toBe(first);
    tracker.dispose();
  });

  it('never reuses a frame id across videos', () => {
    const a = trackVideoFrames(videoWithFrameCallbacks().video);
    const b = trackVideoFrames(videoWithFrameCallbacks().video);
    expect(a.frameId).not.toBe(b.frameId);
    a.dispose();
    b.dispose();
  });

  it('stops listening once disposed', () => {
    const { video, presentFrame } = videoWithFrameCallbacks();
    const onFrame = vi.fn();
    const tracker = trackVideoFrames(video, onFrame);
    tracker.dispose();

    presentFrame();
    video.dispatchEvent(new Event('seeked'));

    expect(onFrame).not.toHaveBeenCalled();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalled();
  });

  it('says nothing about frames when the browser cannot tell (every frame counts as new)', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'requestVideoFrameCallback', { value: undefined });
    expect(trackVideoFrames(video).frameId).toBeUndefined();
  });
});
