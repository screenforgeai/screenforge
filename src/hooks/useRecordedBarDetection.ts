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
import { sampleVideoFrames } from 'src/lib/recording/sampleFrames';

/** About 20 frames across the recording: enough to see which rows never move. */
const SAMPLE_COUNT = 20;

/**
 * Looks once for the person's own browser toolbar in a window recording and,
 * when both signals agree, crops it off (frame.recordedBar). Otherwise it
 * records a guess the Window widget offers as "Adjust crop". Runs in the
 * background after a recording opens; never on a tab, a screen or an import.
 */
export const useRecordedBarDetection = () => {
  const recordingResult = useStore((s) => s.recordingResult);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    const { frame, setFrame } = useStore.getState();
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
      if (cancelled || !sampled || sampled.frames.length === 0) {
        return;
      }
      const first = sampled.frames[0];
      const detection = detectRecordedToolbar(sampled.frames, {
        displaySurface: recordingResult.captureSource?.displaySurface ?? 'window',
        mode: 'auto',
        browser: knownBrowserOf(recordingResult.captureSource),
        // Sampled pixels per screen point, for the browser's usual toolbar height.
        scale: (first?.width ?? 0) / Math.max(recordingResult.recordingArea.width, 1),
      });
      const state = useStore.getState();
      // Another recording opened meanwhile, or this one was already decided.
      if (
        state.recordingResult?.filePath !== filePath ||
        !shouldDetectRecordedBar(state.recordingResult, state.frame)
      ) {
        return;
      }
      const bar = recordedBarFromDetection(detection, first?.height ?? 1, {
        width: sampled.videoWidth,
        height: sampled.videoHeight,
      });
      // Automatic, so not an undo step: the person can switch it to Off.
      setFrame(applyRecordedBar(state.frame, bar, sampled.videoHeight));
    })();

    return () => {
      cancelled = true;
      pendingRef.current = null;
    };
  }, [recordingResult]);
};
