export function buildMergeAudioArgs(
  videoPath: string,
  audioPath: string,
  outPath: string,
  sourceHasAudio: boolean,
  targetDurationMs?: number | null,
): string[] {
  const targetDurationSeconds =
    typeof targetDurationMs === 'number' && targetDurationMs > 0
      ? (targetDurationMs / 1000).toFixed(3)
      : null;

  if (sourceHasAudio) {
    const filterGraph = targetDurationSeconds
      ? `[0:a]aresample=async=1:first_pts=0[a0];[1:a]aresample=async=1:first_pts=0[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0,apad=whole_dur=${targetDurationSeconds},atrim=duration=${targetDurationSeconds}[aout]`
      : '[0:a]aresample=async=1:first_pts=0[a0];[1:a]aresample=async=1:first_pts=0[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[aout]';

    return [
      '-y',
      '-i',
      videoPath,
      '-i',
      audioPath,
      '-filter_complex',
      filterGraph,
      '-map',
      '0:v',
      '-map',
      '[aout]',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      ...(targetDurationSeconds ? ['-t', targetDurationSeconds] : ['-shortest']),
      outPath,
    ];
  }

  return [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-af',
    targetDurationSeconds
      ? `apad=whole_dur=${targetDurationSeconds},atrim=duration=${targetDurationSeconds}`
      : 'apad',
    ...(targetDurationSeconds ? ['-t', targetDurationSeconds] : ['-shortest']),
    outPath,
  ];
}
