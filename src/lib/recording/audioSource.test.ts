import { describe, expect, it } from 'vitest';
import { resolveAudioDecodeCandidates, resolveTimelineAudioPath } from './audioSource';

describe('resolveTimelineAudioPath', () => {
  it('prefers the explicit audio path when present', () => {
    expect(
      resolveTimelineAudioPath({
        filePath: '/tmp/video.mp4',
        audioPath: '/tmp/audio.wav',
        hasEmbeddedAudio: true,
      }),
    ).toBe('/tmp/audio.wav');
  });

  it('falls back to the recording file when it already contains audio', () => {
    expect(
      resolveTimelineAudioPath({
        filePath: '/tmp/video.mp4',
        audioPath: undefined,
        hasEmbeddedAudio: true,
      }),
    ).toBe('/tmp/video.mp4');
  });

  it('returns null for silent recordings without a separate audio track', () => {
    expect(
      resolveTimelineAudioPath({
        filePath: '/tmp/video.mp4',
        audioPath: undefined,
        hasEmbeddedAudio: false,
      }),
    ).toBeNull();
  });
});

describe('resolveAudioDecodeCandidates', () => {
  it('deduplicates the recording file when it is both the timeline and fallback source', () => {
    expect(
      resolveAudioDecodeCandidates({
        filePath: '/tmp/video.mp4',
        audioPath: undefined,
        hasEmbeddedAudio: true,
      }),
    ).toEqual(['/tmp/video.mp4']);
  });

  it('keeps the explicit audio path first and the recording file as fallback', () => {
    expect(
      resolveAudioDecodeCandidates({
        filePath: '/tmp/video.mp4',
        audioPath: '/tmp/audio.wav',
        hasEmbeddedAudio: true,
      }),
    ).toEqual(['/tmp/audio.wav', '/tmp/video.mp4']);
  });
});
