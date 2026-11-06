import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getDirectorAccount, openProjectBundleFromDisk } from './service';

export function registerDirectorChannels(): void {
  handleChannel(CH.director.GET_ACCOUNT, () => getDirectorAccount().getState());
  handleChannel(CH.director.SIGN_IN, () => getDirectorAccount().signIn());
  handleChannel(CH.director.CANCEL_SIGN_IN, () => getDirectorAccount().cancelSignIn());
  handleChannel(CH.director.SIGN_OUT, () => getDirectorAccount().signOut());
  handleChannel(CH.director.OPEN_BUNDLE_FROM_DISK, () => openProjectBundleFromDisk());
}
