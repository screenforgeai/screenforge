import type { WebContents } from 'electron';
import { CH } from '../../channels';
import { handleChannel, handleChannelWithSender, listenChannel } from '../../lib/ipc-main';
import {
  transcribeAudio,
  cancelTranscription,
  getWhisperModelStatus,
  exportSrtFile,
} from './service';
import type { WhisperModel } from '../../../src/types/index';

export function registerCaptionsChannels(): void {
  handleChannelWithSender<
    [string, WhisperModel, string],
    import('../../../src/types/index').CaptionSegment[]
  >(
    CH.captions.TRANSCRIBE,
    async (sender: WebContents, videoPath: string, model: WhisperModel, language: string) => {
      return transcribeAudio(videoPath, model, language, (stage, progress) => {
        if (!sender.isDestroyed()) {
          sender.send(CH.captions.PROGRESS, { stage, progress });
        }
      });
    },
  );

  listenChannel(CH.captions.CANCEL, () => {
    cancelTranscription();
  });

  handleChannel<[WhisperModel], { cached: boolean }>(
    CH.captions.MODEL_STATUS,
    (model: WhisperModel) => getWhisperModelStatus(model),
  );

  handleChannel<[string, string], string | null>(
    CH.captions.EXPORT_SRT,
    (content: string, defaultName: string) => exportSrtFile(content, defaultName),
  );
}
