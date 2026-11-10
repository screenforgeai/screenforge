import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { consumeWhatsNewOnLaunch } from './service';

export function registerWhatsNewChannels(): void {
  handleChannel(CH.whatsNew.CONSUME_ON_LAUNCH, () => consumeWhatsNewOnLaunch());
}
