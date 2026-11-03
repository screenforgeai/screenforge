import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getProjects, saveProject, deleteProject } from './service';
import type { SavedProject } from '../../../src/types/index';

export function registerLibraryChannels(): void {
  handleChannel(CH.library.GET_ALL, () => getProjects());
  handleChannel<[SavedProject], SavedProject>(CH.library.SAVE, (project) => saveProject(project));
  handleChannel<[string], void>(CH.library.DELETE, (id) => deleteProject(id));
}
