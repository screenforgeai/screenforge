import { CH } from '../../channels';
import { handleChannel, listenChannel } from '../../lib/ipc-main';
import type { SelectedArea } from '../../../src/types/index';
import {
  saveRecording,
  saveAudioCapture,
  saveCameraCapture,
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
} from './service';

export function registerRecordingChannels(): void {
  handleChannel<
    [string, SelectedArea | null | undefined, { rendererCapture?: boolean } | undefined],
    void
  >(CH.recording.START, (sourceId, cropArea, options) =>
    startRecording(sourceId, cropArea ?? null, options),
  );

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
      } = await stopRecording(rendererCapture);
      return {
        mouseData: events,
        startTime,
        stopTime,
        durationMs,
        recordingArea,
        captureBoundsTimeline,
        hasEmbeddedAudio,
        filePath,
      };
    },
  );

  handleChannel(CH.recording.DISCARD, () => discardRecording());

  listenChannel(CH.recording.PAUSE, () => pauseRecording());
  listenChannel(CH.recording.RESUME, () => resumeRecording());

  // Manual save triggered from TopNav — writes the final processed buffer to the
  // user's output folder after export encoding.
  handleChannel<[ArrayBuffer], string>(CH.recording.SAVE, (buffer) => saveRecording(buffer));

  handleChannel<[ArrayBuffer], string>(CH.recording.SAVE_AUDIO, (buffer) =>
    saveAudioCapture(buffer),
  );

  handleChannel<[ArrayBuffer], string>(CH.recording.SAVE_CAMERA, (buffer) =>
    saveCameraCapture(buffer),
  );

  handleChannel<[string, string], string>(CH.recording.MERGE_AUDIO, (videoPath, audioPath) =>
    mergeAudio(videoPath, audioPath),
  );

  listenChannel(CH.recording.ACTIVATE_APPEND_MODE, () => activateAppendMode());
  handleChannel(CH.recording.GET_APPEND_MODE, () => getAppendMode());
  handleChannel(CH.recording.CLEAR_APPEND_MODE, () => clearAppendMode());
  handleChannel<[string, string], string>(CH.recording.CONCAT, (firstPath, secondPath) =>
    concatRecordings(firstPath, secondPath),
  );
  handleChannel<[string], string>(CH.recording.REENCODE, (filePath) => reencodeRecording(filePath));

  handleChannel(CH.recording.GET_BACKEND, () => getCaptureBackend());
  handleChannel(CH.recording.GET_SYSTEM_AUDIO_SUPPORT, () => getSystemAudioSupportForCapture());
}
