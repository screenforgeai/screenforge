import { useEffect, useRef } from 'react';
import { useStore } from 'src/store';
import { createScreenforgeFileUrl } from 'src/lib/screenforge-url';
import { detectRecordedToolbar, toolbarSampleTimes } from 'src/lib/window-bar';
import { knownBrowserOf } from 'src/lib/recording/captureSource';
import {
  applyRecordedBar,
  recordedBarFromDetection,
  shouldDetectRecordedBar,
} from 'src/lib/recording/recordedBar';
import {
  distinctFrameCount,
  sampleVideoFrames,
  type SampledFrames,
} from 'src/lib/recording/sampleFrames';
import type { RecordedBarSettings } from 'src/lib/effects/frame';
import type { RecordingResult } from 'src/types';

/** About 20 frames across the recording: enough to see which rows never move. */
const SAMPLE_COUNT = 20;
/** Fewer distinct decoded frames than this can't show what holds still: a guess only, never a crop. */
const MIN_FRAMES_TO_CROP = 10;

/**
 * Detection on the sampled frames, as the recording's settings; null when
 * no frame could be read. A known app that isn't a browser has no browser
 * toolbar to find, so whatever holds still at its top is only offered as a
 * line to check, never cropped by itself; the same with too few frames.
 */
function detect(
  recordingResult: RecordingResult,
  sampled: SampledFrames,
): RecordedBarSettings | null {
  const first = sampled.frames[0];
  if (!first) {
    return null;
  }
  const source = recordingResult.captureSource;
  const browser = knownBrowserOf(source);
  const sure =
    distinctFrameCount(sampled.frames) >= MIN_FRAMES_TO_CROP && !(source?.appName && !browser);
  const detection = detectRecordedToolbar(sampled.frames, {
    displaySurface: source?.displaySurface ?? 'window',
    mode: 'auto',
    browser,
    // Sampled pixels per screen point, for the browser's usual toolbar height.
    scale: first.width / Math.max(recordingResult.recordingArea.width, 1),
  });
  const action = detection.action === 'crop' && !sure ? 'adjust' : detection.action;
  return recordedBarFromDetection({ action, cropTop: detection.cropTop }, first.height, {
    width: sampled.videoWidth,
    height: sampled.videoHeight,
  });
}

/** The recording couldn't be read: no crop, but a line the person can still drag. */
function failedRecordedBar(recordingResult: RecordingResult): RecordedBarSettings {
  return {
    mode: 'auto',
    detected: 'failed',
    cropTop: 0,
    width: recordingResult.recordingArea.width,
    height: recordingResult.recordingArea.height,
  };
}

/**
 * Looks once for the person's own browser toolbar in a window recording and,
 * when both signals agree, crops it off (frame.recordedBar). Otherwise it
 * records a guess the Frame widget offers as "Adjust crop". Runs in the
 * background after a recording opens; never on a tab, a screen or an import.
 */
export const useRecordedBarDetection = () => {
  const recordingResult = useStore((s) => s.recordingResult);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    const { frame } = useStore.getState();
    if (!recordingResult || !shouldDetectRecordedBar(recordingResult, frame)) {
      return;
    }
    const filePath = recordingResult.filePath;
    if (pendingRef.current === filePath) {
      return;
    }
    pendingRef.current = filePath;
    let cancelled = false;

    void (async (): Promise<void> => {
      const sampled = await sampleVideoFrames(
        createScreenforgeFileUrl(filePath),
        toolbarSampleTimes(recordingResult.duration, SAMPLE_COUNT),
      ).catch((): null => null);
      if (cancelled) {
        return;
      }
      const state = useStore.getState();
      // Another recording opened meanwhile, or this one was already decided.
      if (
        state.recordingResult?.filePath !== filePath ||
        !shouldDetectRecordedBar(state.recordingResult, state.frame)
      ) {
        return;
      }
      const bar = sampled ? detect(recordingResult, sampled) : null;
      // Automatic, so not an undo step (the person can switch it to Off), but
      // the project has changed: it is saved with the next autosave.
      useStore.setState((current) => ({
        frame: bar
          ? applyRecordedBar(current.frame, bar, bar.height)
          : { ...current.frame, recordedBar: failedRecordedBar(recordingResult) },
        editVersion: current.editVersion + 1,
      }));
    })();

    return () => {
      cancelled = true;
      pendingRef.current = null;
    };
  }, [recordingResult]);
};
