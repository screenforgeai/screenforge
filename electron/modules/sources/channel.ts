import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getSources } from './service';
import { setShareKind, type ShareKind } from './share-kind';
import {
  endWaylandShare,
  getWaylandShareStill,
  pickWaylandScreen,
  type ScreenPick,
} from '../recording/wayland-capture';
import { isWaylandSession } from '../../lib/linux-capture';

export function registerSourcesChannels(): void {
  handleChannel(CH.sources.GET, () => getSources());
  handleChannel<[ShareKind], void>(CH.sources.SET_SHARE_KIND, (kind) => setShareKind(kind));
  handleChannel<[], ScreenPick>(CH.sources.PICK_SCREEN, () =>
    process.platform === 'linux' && isWaylandSession()
      ? pickWaylandScreen()
      : Promise.resolve('unavailable'),
  );
  handleChannel(CH.sources.SCREEN_STILL, () => getWaylandShareStill());
  handleChannel<[], void>(CH.sources.END_SHARE, () => endWaylandShare());
}
