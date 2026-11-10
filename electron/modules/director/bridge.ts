import { CH } from '../../channels';
import { createInvokeBridge, createSubscription } from '../../lib/ipc-renderer';
import type { DirectorAccountState } from '../../../src/types/index';

export const directorBridge = {
  getDirectorAccount: createInvokeBridge<[], DirectorAccountState>(CH.director.GET_ACCOUNT),
  signInToDirector: createInvokeBridge<[], void>(CH.director.SIGN_IN),
  cancelDirectorSignIn: createInvokeBridge<[], void>(CH.director.CANCEL_SIGN_IN),
  signOutOfDirector: createInvokeBridge<[], void>(CH.director.SIGN_OUT),
  onDirectorAccountChanged: createSubscription<DirectorAccountState>(CH.director.ACCOUNT_CHANGED),
};
