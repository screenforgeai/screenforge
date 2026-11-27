import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getAudioPeaks, type AudioPeaks } from './service';

export function registerAudioPeaksChannels(): void {
  handleChannel<[string], AudioPeaks | null>(CH.audioPeaks.GET, (filePath) =>
    getAudioPeaks(filePath),
  );
}
