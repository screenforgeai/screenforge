import { CH } from '../../channels';
import { createInvokeBridge, createSubscription } from '../../lib/ipc-renderer';
import type {
  ShareActionResult,
  ShareJobState,
  ShareLibrary,
  ShareRequest,
} from '../../../src/types/index';

export const shareBridge = {
  shareVideo: createInvokeBridge<[ShareRequest], ShareJobState>(CH.share.START),
  cancelShare: createInvokeBridge<[], void>(CH.share.CANCEL),
  getShareState: createInvokeBridge<[], ShareJobState>(CH.share.GET_STATE),
  onShareStateChanged: createSubscription<ShareJobState>(CH.share.STATE_CHANGED),
  canResumeShare: createInvokeBridge<[string], boolean>(CH.share.CAN_RESUME),
  getShareLibrary: createInvokeBridge<[], ShareLibrary>(CH.share.GET_LIBRARY),
  refreshShareLibrary: createInvokeBridge<[], ShareLibrary>(CH.share.REFRESH_LIBRARY),
  onShareLibraryChanged: createSubscription<ShareLibrary>(CH.share.LIBRARY_CHANGED),
  removeShareLink: createInvokeBridge<[string], ShareActionResult>(CH.share.REMOVE_LINK),
  copyShareLink: createInvokeBridge<[string], boolean>(CH.share.COPY_LINK),
  resumeProjectShare: createInvokeBridge<[string], ShareJobState>(CH.share.RESUME_PROJECT),
  discardProjectShare: createInvokeBridge<[string], ShareActionResult>(CH.share.DISCARD_PENDING),
};
