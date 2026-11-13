import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grabStreamStill } from './streamStill';

class FakeTrack extends EventTarget {
  readyState: 'live' | 'ended' = 'live';
  end(): void {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

function fakeStream(track: FakeTrack): MediaStream {
  return { getVideoTracks: () => [track] } as unknown as MediaStream;
}

describe('grabStreamStill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A stream that never shows a frame: playback never starts.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockReturnValue(new Promise(() => undefined));
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops waiting when the share ends before a picture arrives', async () => {
    const track = new FakeTrack();
    const still = grabStreamStill(fakeStream(track));
    track.end();
    await expect(still).rejects.toThrow(/stopped/i);
  });

  it('gives up when no picture arrives in time', async () => {
    const still = grabStreamStill(fakeStream(new FakeTrack()));
    const failed = expect(still).rejects.toThrow(/no picture/i);
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
  });

  it('fails at once when the share has already ended', async () => {
    const track = new FakeTrack();
    track.readyState = 'ended';
    await expect(grabStreamStill(fakeStream(track))).rejects.toThrow(/stopped/i);
  });
});
