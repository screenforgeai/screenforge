import { CH } from '../../channels';
import { createInvokeBridge } from '../../lib/ipc-renderer';
import type { DesktopSource } from '../../../src/types/index';

export const sourcesBridge = {
  getSources: createInvokeBridge<[], DesktopSource[]>(CH.sources.GET),
};
