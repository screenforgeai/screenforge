import { CH } from '../../channels';
import {
  createInvokeBridge,
  createSendBridge,
  createSubscription,
  createVoidSubscription,
} from '../../lib/ipc-renderer';
import type {
  CaptureBackend,
  CursorEvent,
  RecordingArea,
  RecordingBoundsSample,
  RecordingResult,
} from '../../../src/types/index';

export const recordingBridge = {
  startRecording: createInvokeBridge<
    [
      string,
      { x: number; y: number; width: number; height: number } | null | undefined,
      { rendererCapture?: boolean }?,
    ],
    void
  >(CH.recording.START),
  stopRecording: createInvokeBridge<
    [rendererCapture?: { webmPath: string; width?: number; height?: number }],
    {
      mouseData: CursorEvent[];
      startTime: number;
      stopTime: number;
      durationMs: number;
      recordingArea: RecordingArea;
      captureBoundsTimeline?: RecordingBoundsSample[];
      hasEmbeddedAudio: boolean;
      filePath: string;
    }
  >(CH.recording.STOP),
  getCaptureBackend: createInvokeBridge<[], CaptureBackend>(CH.recording.GET_BACKEND),
  pauseRecording: createSendBridge<[]>(CH.recording.PAUSE),
  resumeRecording: createSendBridge<[]>(CH.recording.RESUME),
  discardRecording: createInvokeBridge<[], void>(CH.recording.DISCARD),
  saveRecording: createInvokeBridge<[ArrayBuffer], string>(CH.recording.SAVE),
  saveAudioCapture: createInvokeBridge<[ArrayBuffer], string>(CH.recording.SAVE_AUDIO),
  saveCameraCapture: createInvokeBridge<[ArrayBuffer], string>(CH.recording.SAVE_CAMERA),
  mergeAudio: createInvokeBridge<[string, string], string>(CH.recording.MERGE_AUDIO),
  recordingFinished: createSendBridge<[RecordingResult]>(CH.recording.FINISHED),
  recordingFailed: createSendBridge<[string]>(CH.recording.FAILED),
  recordingProcessing: createSendBridge<[]>(CH.recording.PROCESSING),
  onRecordingProcessing: createVoidSubscription(CH.recording.PROCESSING),

  /** Linux only: hides the toolbar window so it doesn't appear in the recording. No-op on other platforms. */
  hideToolbar: createSendBridge<[]>(CH.recording.HIDE_TOOLBAR),
  onRecordingLoad: createSubscription<RecordingResult>(CH.recording.LOAD),
  onRecordingFailed: createSubscription<string>(CH.recording.FAILED),
  onStopRequested: createVoidSubscription(CH.recording.STOP_REQUESTED),
  activateAppendMode: createSendBridge<[]>(CH.recording.ACTIVATE_APPEND_MODE),
  getAppendMode: createInvokeBridge<[], boolean>(CH.recording.GET_APPEND_MODE),
  clearAppendMode: createInvokeBridge<[], void>(CH.recording.CLEAR_APPEND_MODE),
  concatRecordings: createInvokeBridge<[string, string], string>(CH.recording.CONCAT),
  reencodeRecording: createInvokeBridge<[string], string>(CH.recording.REENCODE),
};
