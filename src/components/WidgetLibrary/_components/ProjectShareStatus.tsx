import type { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { IconCopy, IconLink, IconTrash } from 'src/lib/icons';
import { formatShareDate, shareExpiry } from 'src/lib/share';
import { Spinner } from 'src/lib/ui';
import type { ProjectShareLink, ShareJobState, ShareLibrary } from 'src/types';

interface ProjectShareStatusProps {
  projectId: string;
  link?: ProjectShareLink;
  pending?: ShareLibrary['pending'][string];
  job: ShareJobState;
  onRemove: (link: ProjectShareLink) => void;
}

/** Keeps a click on an action from also opening the project card around it. */
const stop =
  (action: () => void) =>
  (event: MouseEvent): void => {
    event.stopPropagation();
    action();
  };

const ActionButton = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={stop(onClick)}
    className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 text-xs text-sf-secondary transition-colors hover:bg-sf-panel hover:text-sf-primary"
  >
    {children}
  </button>
);

/** A project's share link in the library: where it is, when it expires (#26). */
export const ProjectShareStatus = ({
  projectId,
  link,
  pending,
  job,
  onRemove,
}: ProjectShareStatusProps) => {
  const { t, i18n } = useTranslation('recordings');

  const row = (children: ReactNode) => (
    <div className="flex min-h-9 items-center gap-2 border-t border-sf-border bg-[#181818] px-2.5 py-1.5 text-xs">
      {children}
    </div>
  );

  const isThisJob = job.status !== 'idle' && job.projectId === projectId;
  if (
    isThisJob &&
    (job.status === 'preparing' || job.status === 'uploading' || job.status === 'finishing')
  ) {
    const percent =
      job.status === 'uploading' && job.totalBytes > 0
        ? Math.round((job.uploadedBytes / job.totalBytes) * 100)
        : job.status === 'finishing'
          ? 100
          : 0;
    return row(
      <span className="flex items-center gap-2 text-sf-secondary">
        <Spinner className="size-3 text-sf-border fill-sf-primary" />
        {t('link_uploading', { percent })}
      </span>,
    );
  }

  if (pending) {
    return row(
      <>
        <span className="mr-auto truncate text-sf-secondary">{t('link_paused')}</span>
        <ActionButton
          label={t('link_resume')}
          onClick={() => void window.screenforge.resumeProjectShare(projectId)}
        >
          {t('link_resume')}
        </ActionButton>
        <ActionButton
          label={t('link_discard')}
          onClick={() => void window.screenforge.discardProjectShare(projectId)}
        >
          {t('link_discard')}
        </ActionButton>
      </>,
    );
  }

  if (!link) {
    return null;
  }

  const expiry = shareExpiry(link);
  const isLive = expiry.kind === 'expires' || expiry.kind === 'never';

  const copy = () => {
    void window.screenforge
      .copyShareLink(projectId)
      .then((copied) => {
        if (copied) {
          toast.success(t('link_copied'));
        }
      })
      .catch(() => undefined);
  };

  return row(
    <>
      <IconLink
        size={12}
        className={isLive ? 'shrink-0 text-sf-primary' : 'shrink-0 text-sf-muted'}
      />
      <div className="min-w-0 flex-1">
        {isLive && link.watchUrl ? (
          <>
            <button
              type="button"
              title={link.watchUrl}
              onClick={stop(
                () => link.watchUrl && window.screenforge.openExternalUrl(link.watchUrl),
              )}
              className="block max-w-full cursor-pointer truncate text-left text-sf-primary underline-offset-2 hover:underline"
            >
              {link.watchUrl}
            </button>
            <span className="block text-sf-muted">
              {expiry.kind === 'expires'
                ? t('link_expires', { date: formatShareDate(expiry.at, i18n.language) })
                : t('link_neverExpires')}
            </span>
          </>
        ) : (
          <span className="text-sf-muted">
            {expiry.kind === 'removed' ? t('link_removed') : t('link_expired')}
          </span>
        )}
      </div>
      {isLive && link.watchUrl && (
        <ActionButton label={t('link_copy')} onClick={copy}>
          <IconCopy size={12} />
        </ActionButton>
      )}
      <ActionButton label={t('link_remove')} onClick={() => onRemove(link)}>
        <IconTrash size={12} />
      </ActionButton>
    </>,
  );
};
