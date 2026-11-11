import { CH } from '../../channels';
import { handleChannel, listenChannel } from '../../lib/ipc-main';
import type { RegisteredCaptureShortcuts } from '../../../src/types/index';
import { getRegisteredCaptureShortcuts, setToolbarRecording } from './service';

export function registerCaptureShortcutChannels(): void {
  handleChannel<[], RegisteredCaptureShortcuts>(CH.captureShortcuts.GET, () =>
    getRegisteredCaptureShortcuts(),
  );

  listenChannel<[unknown]>(CH.captureShortcuts.TOOLBAR_RECORDING, (active) =>
    setToolbarRecording(active === true),
  );
}
