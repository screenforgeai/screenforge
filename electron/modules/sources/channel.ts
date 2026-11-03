import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getSources } from './service';

export function registerSourcesChannels(): void {
  handleChannel(CH.sources.GET, () => getSources());
}
