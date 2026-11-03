import { CH } from '../../channels';
import { createInvokeBridge, createSendBridge, createSubscription } from '../../lib/ipc-renderer';
import type { CaptionSegment, WhisperModel } from '../../../src/types/index';

export const captionsBridge = {
  transcribeAudio: createInvokeBridge<[string, WhisperModel, string], CaptionSegment[]>(
    CH.captions.TRANSCRIBE,
  ),
  onTranscribeProgress: createSubscription<{
    stage: 'model-load' | 'transcribing';
    progress: number;
  }>(CH.captions.PROGRESS),
  cancelTranscription: createSendBridge<[]>(CH.captions.CANCEL),
  getWhisperModelStatus: createInvokeBridge<[WhisperModel], { cached: boolean }>(
    CH.captions.MODEL_STATUS,
  ),
  exportSrtFile: createInvokeBridge<[string, string], string | null>(CH.captions.EXPORT_SRT),
};
