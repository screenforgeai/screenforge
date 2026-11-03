import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { isFFmpegAvailable } from './index';

export function registerFFmpegSetupChannels(): void {
  handleChannel<[], { available: boolean }>(CH.ffmpeg.SETUP_STATUS, async () => {
    const available = await isFFmpegAvailable();
    return { available };
  });
}
