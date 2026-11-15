import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getFeatureFlags } from './service';

export function registerFeatureChannels(): void {
  handleChannel(CH.features.GET, () => getFeatureFlags());
}
