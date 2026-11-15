import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getDirectorAccount } from './service';
import { getFeatureFlags } from '../features/service';

export function registerDirectorChannels(): void {
  handleChannel(CH.director.GET_ACCOUNT, () => getDirectorAccount().getState());
  handleChannel(CH.director.SIGN_IN, () => {
    if (!getFeatureFlags().directorSharing) {
      throw new Error('Screenforge Director is not available in this version yet.');
    }
    return getDirectorAccount().signIn();
  });
  handleChannel(CH.director.CANCEL_SIGN_IN, () => getDirectorAccount().cancelSignIn());
  handleChannel(CH.director.SIGN_OUT, () => getDirectorAccount().signOut());
}
