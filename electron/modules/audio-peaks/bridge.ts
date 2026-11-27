import { CH } from '../../channels';
import { createInvokeBridge } from '../../lib/ipc-renderer';
import type { AudioPeaks } from '../../../src/types/index';

export const audioPeaksBridge = {
  getAudioPeaks: createInvokeBridge<[string], AudioPeaks | null>(CH.audioPeaks.GET),
};
