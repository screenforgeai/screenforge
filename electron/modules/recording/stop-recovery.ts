import type { RecordingResult } from '../../../src/types/index';
import type { stopRecording as StopRecording } from './service';

export type StopResult = Awaited<ReturnType<typeof StopRecording>>;
type RendererCapture = Parameters<typeof StopRecording>[0];

type StopRecoveryDeps = {
  stopRecording: (rendererCapture?: RendererCapture) => Promise<StopResult>;
  isRecordingBusy: () => boolean;
};

/**
 * Remembers the stop the toolbar asked for, so the main process can still hand
 * the screen recording to the editor if the toolbar's (hidden) renderer dies
 * before it reports back. Mic and camera live in the toolbar and are lost then.
 */
export function createStopRecovery({ stopRecording, isRecordingBusy }: StopRecoveryDeps) {
  let inFlight: Promise<StopResult> | null = null;

  const track = (promise: Promise<StopResult>) => {
    inFlight = promise;
    // The caller handles the rejection; this copy is only kept for recover().
    promise.catch(() => undefined);
    return promise;
  };

  return {
    stop(rendererCapture?: RendererCapture): Promise<StopResult> {
      return track(stopRecording(rendererCapture));
    },

    /** Forgets the last stop, once its result reached the editor (or a new take starts). */
    reset(): void {
      inFlight = null;
    },

    /**
     * The last stop's recording, finishing a capture that is still running.
     * Null when there is nothing to recover.
     */
    async recover(): Promise<RecordingResult | null> {
      const pending = inFlight ?? (isRecordingBusy() ? track(stopRecording(undefined)) : null);
      if (!pending) {
        return null;
      }
      const result = await pending;
      const durationMs =
        result.durationMs > 0 ? result.durationMs : Math.max(0, result.stopTime - result.startTime);
      return {
        filePath: result.filePath,
        mouseData: result.events,
        duration: durationMs / 1000,
        startTime: result.startTime,
        recordingArea: result.recordingArea,
        captureBoundsTimeline: result.captureBoundsTimeline,
        areaCrop: result.areaCrop,
        hasEmbeddedAudio: result.hasEmbeddedAudio,
      };
    },
  };
}
