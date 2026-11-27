import { CH } from '../../channels';
import { handleChannel, listenChannel } from '../../lib/ipc-main';
import type { ConcatRecordingsOptions, SelectedArea } from '../../../src/types/index';
import {
  mergeAudio,
  startRecording,
  stopRecording,
  discardRecording,
  pauseRecording,
  resumeRecording,
  activateAppendMode,
  getAppendMode,
  clearAppendMode,
  concatRecordings,
  reencodeRecording,
  getCaptureBackend,
  getSystemAudioSupportForCapture,
  isRecordingBusy,
} from './service';
import { createStopRecovery } from './stop-recovery';
import {
  abortCaptureStream,
  appendCaptureStream,
  closeCaptureStream,
  openCaptureStream,
  type CaptureStreamKind,
} from './capture-stream';

/** Lets the window controller finish a stop whose toolbar died mid-save. */
export const stopRecovery = createStopRecovery({ stopRecording, isRecordingBusy });

export function registerRecordingChannels(): void {
  handleChannel<
    [string, SelectedArea | null | undefined, { rendererCapture?: boolean } | undefined],
    void
  >(CH.recording.START, (sourceId, cropArea, options) => {
    stopRecovery.reset();
    return startRecording(sourceId, cropArea ?? null, options);
  });

  handleChannel(
    CH.recording.STOP,
    async (rendererCapture?: { webmPath: string; width?: number; height?: number }) => {
      const {
        events,
        startTime,
        stopTime,
        durationMs,
        recordingArea,
        captureBoundsTimeline,
        hasEmbeddedAudio,
        filePath,
        areaCrop,
      } = await stopRecovery.stop(rendererCapture);
      return {
        mouseData: events,
        startTime,
        stopTime,
        durationMs,
        recordingArea,
        captureBoundsTimeline,
        hasEmbeddedAudio,
        filePath,
        areaCrop,
      };
    },
  );

  handleChannel(CH.recording.DISCARD, () => discardRecording());

  listenChannel(CH.recording.PAUSE, () => pauseRecording());
  listenChannel(CH.recording.RESUME, () => resumeRecording());

  // The toolbar's MediaRecorders (mic, camera, Wayland screen) append each
  // chunk to a temp file as it arrives, instead of sending the whole take at stop.
  handleChannel<[CaptureStreamKind], string>(CH.recording.STREAM_OPEN, (kind) =>
    openCaptureStream(kind),
  );
  handleChannel<[string, ArrayBuffer], void>(CH.recording.STREAM_APPEND, (id, chunk) =>
    appendCaptureStream(id, chunk),
  );
  handleChannel<[string], string>(CH.recording.STREAM_CLOSE, (id) => closeCaptureStream(id));
  handleChannel<[string], void>(CH.recording.STREAM_ABORT, (id) => abortCaptureStream(id));

  handleChannel<[string, string], string>(CH.recording.MERGE_AUDIO, (videoPath, audioPath) =>
    mergeAudio(videoPath, audioPath),
  );

  listenChannel(CH.recording.ACTIVATE_APPEND_MODE, () => activateAppendMode());
  handleChannel(CH.recording.GET_APPEND_MODE, () => getAppendMode());
  handleChannel(CH.recording.CLEAR_APPEND_MODE, () => clearAppendMode());
  handleChannel<[string, string, ConcatRecordingsOptions | undefined], string>(
    CH.recording.CONCAT,
    (firstPath, secondPath, options) => concatRecordings(firstPath, secondPath, options),
  );
  handleChannel<[string], string>(CH.recording.REENCODE, (filePath) => reencodeRecording(filePath));

  handleChannel(CH.recording.GET_BACKEND, () => getCaptureBackend());
  handleChannel(CH.recording.GET_SYSTEM_AUDIO_SUPPORT, () => getSystemAudioSupportForCapture());
}
