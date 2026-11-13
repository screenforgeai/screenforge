import { CH } from '../../channels';
import { createInvokeBridge } from '../../lib/ipc-renderer';
import type { DesktopSource } from '../../../src/types/index';

export const sourcesBridge = {
  getSources: createInvokeBridge<[], DesktopSource[]>(CH.sources.GET),
  /**
   * Wayland: what the next screen-share dialog asks for, a screen or a window. Awaited, so it is
   * stored before the share request that reads it.
   */
  setShareKind: createInvokeBridge<['screen' | 'window'], void>(CH.sources.SET_SHARE_KIND),
};
