import { CH } from '../../channels';
import { createInvokeBridge, createSubscription } from '../../lib/ipc-renderer';
import type { RecordingResult } from '../../../src/types/index';

export const importBridge = {
  importVideo: createInvokeBridge<[], RecordingResult | null>(CH.import.PICK),
  importVideoForInsert: createInvokeBridge<[], RecordingResult | null>(CH.import.PICK_FOR_INSERT),
  importSampleProject: createInvokeBridge<[], RecordingResult>(CH.import.SAMPLE),
  onImportTriggeredFromTray: createSubscription<RecordingResult>(CH.import.TRIGGER),
};
