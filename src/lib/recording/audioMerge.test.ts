import { describe, expect, it } from 'vitest';
import { buildMergeAudioArgs } from './audioMerge';

describe('buildMergeAudioArgs', () => {
  it('mixes source audio with mic audio when the recording already has audio', () => {
    const args = buildMergeAudioArgs('/tmp/video.mp4', '/tmp/mic.webm', '/tmp/out.mp4', true);

    expect(args).toContain('-filter_complex');
    expect(args).toContain(
      '[0:a]aresample=async=1:first_pts=0[a0];[1:a]aresample=async=1:first_pts=0[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[aout]',
    );
    expect(args).toContain('[aout]');
    expect(args).not.toContain('apad');
  });

  it('falls back to mic-only merge when the recording has no source audio', () => {
    const args = buildMergeAudioArgs('/tmp/video.mp4', '/tmp/mic.webm', '/tmp/out.mp4', false);

    expect(args).not.toContain('-filter_complex');
    expect(args).toContain('1:a');
    expect(args).toContain('apad');
  });

  it('uses the target video duration when one is provided', () => {
    const args = buildMergeAudioArgs(
      '/tmp/video.mp4',
      '/tmp/mic.webm',
      '/tmp/out.mp4',
      true,
      24_700,
    );

    expect(args).toContain(
      '[0:a]aresample=async=1:first_pts=0[a0];[1:a]aresample=async=1:first_pts=0[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0,apad=whole_dur=24.700,atrim=duration=24.700[aout]',
    );
    expect(args).toContain('-t');
    expect(args).toContain('24.700');
    expect(args).not.toContain('-shortest');
  });
});
