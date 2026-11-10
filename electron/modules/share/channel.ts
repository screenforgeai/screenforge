import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import { getShareManager } from './service';
import type { ShareRequest } from '../../../src/types/index';

const isShareRequest = (value: unknown): value is ShareRequest => {
  const r = value as Partial<ShareRequest> | null;
  return (
    !!r &&
    typeof r.filePath === 'string' &&
    typeof r.title === 'string' &&
    typeof r.durationS === 'number' &&
    Number.isFinite(r.durationS) &&
    (r.projectId === null || typeof r.projectId === 'string')
  );
};

export function registerShareChannels(): void {
  const shares = () => getShareManager();
  handleChannel(CH.share.START, (request: unknown) => {
    if (!isShareRequest(request)) {
      throw new Error('Invalid share request.');
    }
    return shares().share(request);
  });
  handleChannel(CH.share.CANCEL, () => shares().cancel());
  handleChannel(CH.share.GET_STATE, () => shares().getState());
  handleChannel(CH.share.CAN_RESUME, (filePath: string) => shares().canResume(String(filePath)));
  handleChannel(CH.share.GET_LIBRARY, () => shares().getLibrary());
  handleChannel(CH.share.REFRESH_LIBRARY, () => shares().refreshLibrary());
  handleChannel(CH.share.REMOVE_LINK, (projectId: string) =>
    shares().removeLink(String(projectId)),
  );
  handleChannel(CH.share.COPY_LINK, (projectId: string) => shares().copyLink(String(projectId)));
  handleChannel(CH.share.RESUME_PROJECT, (projectId: string) =>
    shares().resumeProject(String(projectId)),
  );
  handleChannel(CH.share.DISCARD_PENDING, (projectId: string) =>
    shares().discardPending(String(projectId)),
  );
}
