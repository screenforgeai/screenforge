import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import type { RegisteredCaptureShortcuts } from '../../../src/types/index';
import { getRegisteredCaptureShortcuts } from './service';

export function registerCaptureShortcutChannels(): void {
  handleChannel<[], RegisteredCaptureShortcuts>(CH.captureShortcuts.GET, () =>
    getRegisteredCaptureShortcuts(),
  );
}
