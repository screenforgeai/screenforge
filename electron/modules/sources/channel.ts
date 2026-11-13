import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getSources } from './service';
import { setShareKind, type ShareKind } from './share-kind';

export function registerSourcesChannels(): void {
  handleChannel(CH.sources.GET, () => getSources());
  handleChannel<[ShareKind], void>(CH.sources.SET_SHARE_KIND, (kind) => setShareKind(kind));
}
