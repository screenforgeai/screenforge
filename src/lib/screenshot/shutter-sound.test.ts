import { afterEach, describe, expect, it, vi } from 'vitest';
import { playShutterSound } from './shutter-sound';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('playShutterSound', () => {
  it('plays the camera capture sound', () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const AudioStub = vi.fn(function (this: { play: typeof play }) {
      this.play = play;
    });
    vi.stubGlobal('Audio', AudioStub);
    playShutterSound();
    expect(AudioStub).toHaveBeenCalledWith(expect.stringContaining('camera-capture'));
    expect(play).toHaveBeenCalled();
  });

  it('stays quiet when the system refuses to play audio', async () => {
    const play = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal(
      'Audio',
      vi.fn(function (this: { play: typeof play }) {
        this.play = play;
      }),
    );
    expect(() => playShutterSound()).not.toThrow();
    // A rejected play() must not surface as an unhandled rejection.
    await Promise.resolve();
  });
});
