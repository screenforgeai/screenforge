import type { CursorEvent, RecordingResult } from '../types';

/** File name of the bundled sample recording (src/assets/sample-project/). */
export const SAMPLE_PROJECT_VIDEO_FILENAME = 'sample-project.mp4';

/**
 * The input events that go with the sample video, written by
 * scripts/generate-sample-project.mjs. Timestamps are milliseconds from the
 * start of the clip; x/y are logical pixels within width × height.
 */
export interface SampleProjectManifest {
  version: number;
  width: number;
  height: number;
  duration: number;
  events: CursorEvent[];
}

/**
 * Turns the manifest into a RecordingResult for a copy of the sample video,
 * as if it had just been recorded starting at `startTime`.
 */
export function buildSampleRecordingResult(
  manifest: SampleProjectManifest,
  filePath: string,
  startTime: number,
): RecordingResult {
  return {
    filePath,
    mouseData: manifest.events.map((event) => ({
      ...event,
      ...(event.modifiers ? { modifiers: { ...event.modifiers } } : {}),
      timestamp: startTime + event.timestamp,
    })),
    duration: manifest.duration,
    startTime,
    recordingArea: { x: 0, y: 0, width: manifest.width, height: manifest.height },
    hasEmbeddedAudio: false,
  };
}
