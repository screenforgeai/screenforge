import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShareJob } from 'src/hooks/useShareJob';
import type { ShareJobState } from 'src/types';

const ACTIVE: ReadonlySet<ShareJobState['status']> = new Set([
  'preparing',
  'uploading',
  'finishing',
]);

/**
 * Says how a share upload ended when nothing on screen shows it: the
 * export window was closed mid-upload, it shows another export, or the
 * upload was resumed from Recordings. `shownFilePath` is the export the
 * open window's share panel shows, if any.
 */
export const ShareBackgroundToasts = ({
  shownFilePath,
}: {
  shownFilePath: string | null;
}): null => {
  const { t } = useTranslation('export');
  const job = useShareJob();
  const previous = useRef<ShareJobState['status']>(job.status);

  useEffect(() => {
    const wasActive = ACTIVE.has(previous.current);
    previous.current = job.status;
    const shown = job.status !== 'idle' && job.filePath === shownFilePath;
    if (shown || !wasActive) {
      return;
    }
    if (job.status === 'done') {
      toast.success(t(job.copied ? 'share_backgroundDone' : 'share_ready'), {
        description: job.link.watchUrl ?? undefined,
      });
    } else if (job.status === 'failed') {
      toast.error(t(`share_error_${job.error}`));
    }
  }, [job, shownFilePath, t]);

  return null;
};
