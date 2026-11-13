import { CH } from '../../channels';
import { createInvokeBridge, createSendBridge } from '../../lib/ipc-renderer';
import type { DesktopSource } from '../../../src/types/index';

export const sourcesBridge = {
  getSources: createInvokeBridge<[], DesktopSource[]>(CH.sources.GET),
  /** Wayland: what the next screen-share dialog asks for, a screen or a window. */
  setShareKind: createSendBridge<['screen' | 'window']>(CH.sources.SET_SHARE_KIND),
};
