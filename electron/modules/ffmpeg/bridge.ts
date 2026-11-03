import { CH } from '../../channels';
import { createInvokeBridge, createSendBridge, createSubscription } from '../../lib/ipc-renderer';

export const ffmpegBridge = {
  checkFFmpegStatus: createInvokeBridge<[], { available: boolean }>(CH.ffmpeg.SETUP_STATUS),
  installFFmpeg: createSendBridge<[]>(CH.ffmpeg.INSTALL),
  onInstallProgress: createSubscription<{ downloaded: number; total: number }>(
    CH.ffmpeg.INSTALL_PROGRESS,
  ),
  onInstallDone: createSubscription<{ success: boolean; error?: string }>(CH.ffmpeg.INSTALL_DONE),
};
