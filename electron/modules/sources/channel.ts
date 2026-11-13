import { CH } from '../../channels';
import { handleChannel, listenChannel } from '../../lib/ipc-main';
import { getSources } from './service';
import { setShareKind, type ShareKind } from './share-kind';

export function registerSourcesChannels(): void {
  handleChannel(CH.sources.GET, () => getSources());
  listenChannel<[ShareKind]>(CH.sources.SET_SHARE_KIND, (kind) => setShareKind(kind));
}
