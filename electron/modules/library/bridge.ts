import { CH } from '../../channels';
import { createInvokeBridge } from '../../lib/ipc-renderer';
import type { SavedProject } from '../../../src/types/index';

export const libraryBridge = {
  saveProject: createInvokeBridge<[SavedProject], SavedProject>(CH.library.SAVE),
  getProjects: createInvokeBridge<[], SavedProject[]>(CH.library.GET_ALL),
  deleteProject: createInvokeBridge<[string], void>(CH.library.DELETE),
};
