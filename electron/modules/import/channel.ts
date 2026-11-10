import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { importSampleProject, pickAndImportVideo } from './service';
import type { RecordingResult } from '../../../src/types/index';

export function registerImportChannels(): void {
  handleChannel<[], RecordingResult | null>(CH.import.PICK, () => pickAndImportVideo());
  handleChannel<[], RecordingResult | null>(CH.import.PICK_FOR_INSERT, () => pickAndImportVideo());
  handleChannel<[], RecordingResult>(CH.import.SAMPLE, () => importSampleProject());
}
