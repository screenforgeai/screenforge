import type { RecordingResult } from '../../types/index';

type RecordingAudioSource = Pick<RecordingResult, 'audioPath' | 'filePath' | 'hasEmbeddedAudio'>;

export function resolveTimelineAudioPath(recording: RecordingAudioSource): string | null {
  if (recording.audioPath) {
    return recording.audioPath;
  }

  return recording.hasEmbeddedAudio ? recording.filePath : null;
}

export function resolveAudioDecodeCandidates(recording: RecordingAudioSource): string[] {
  const timelineAudioPath = resolveTimelineAudioPath(recording);

  return Array.from(
    new Set(
      [timelineAudioPath, recording.filePath].filter((path): path is string => Boolean(path)),
    ),
  );
}
