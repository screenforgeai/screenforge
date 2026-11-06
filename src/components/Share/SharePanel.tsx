import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDirectorAccount } from 'src/hooks/useDirectorAccount';
import { useShareJob } from 'src/hooks/useShareJob';
import { IconCopy, IconLink } from 'src/lib/icons';
import { formatShareDate, isShareableFormat, shareExpiry } from 'src/lib/share';
import { openSettings } from 'src/lib/settingsNavigation';
import { trackEvent } from 'src/lib/analytics';
import { useStore } from 'src/store';
import { Button, Progress, Spinner } from 'src/lib/ui';
import type { ExportFormat, ProjectShareLink, ShareErrorCode, ShareJobState } from 'src/types';

/** Errors that sharing the same file again can't fix. */
const FINAL_ERRORS: ReadonlySet<ShareErrorCode> = new Set([
  'unsupported-format',
  'file-missing',
  'too-large',
  'too-long',
]);

interface SharePanelProps {
  filePath: string;
  format: ExportFormat;
  durationS: number;
  title: string;
  projectId: string | null;
}

const formatBytes = (bytes: number): string => {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `${Math.round(bytes / 1_000_000)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
};

const ExpiryText = ({ link }: { link: ProjectShareLink }) => {
  const { t, i18n } = useTranslation('export');
  const expiry = shareExpiry(link);
  if (expiry.kind === 'expires') {
    return <>{t('share_expires', { date: formatShareDate(expiry.at, i18n.language) })}</>;
  }
  return <>{t('share_neverExpires')}</>;
};

/** After an export: upload the video to Director and copy its link (#26). */
export const SharePanel = ({ filePath, format, durationS, title, projectId }: SharePanelProps) => {
  const { t } = useTranslation('export');
  const account = useDirectorAccount();
  const job = useShareJob();
  const [canResume, setCanResume] = useState(false);
  const shareable = isShareableFormat(format);
  const setFocusMode = useStore((s) => s.setFocusMode);

  const openDirectorSettings = () => {
    // Settings lives in the sidebar, which focus mode hides.
    setFocusMode(false);
    openSettings('director');
  };

  useEffect(() => {
    if (!shareable) {
      return;
    }
    let cancelled = false;
    void window.screenforge
      .canResumeShare(filePath)
      .then((value) => {
        if (!cancelled) {
          setCanResume(value);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [filePath, shareable]);

  // The main process runs one share at a time; only this file's matters here.
  const state: ShareJobState =
    job.status !== 'idle' && job.filePath === filePath ? job : { status: 'idle' };

  const startShare = () => {
    trackEvent('share_link_started', { format, resumed: canResume });
    void window.screenforge
      .shareVideo({ filePath, projectId, title, durationS })
      .then((result) => {
        if (result.status === 'done') {
          trackEvent('share_link_created', { format });
        } else if (result.status === 'failed') {
          setCanResume(result.resumable);
          trackEvent('share_link_failed', { error: result.error });
        }
      })
      .catch(() => undefined);
  };

  const copyLink = async (link: ProjectShareLink) => {
    if (!link.watchUrl) {
      return;
    }
    const copied = projectId
      ? await window.screenforge.copyShareLink(projectId).catch(() => false)
      : await navigator.clipboard.writeText(link.watchUrl).then(
          () => true,
          () => false,
        );
    if (copied) {
      toast.success(t('share_copyDone'));
    }
  };

  const shell = (children: React.ReactNode) => (
    <section
      aria-label={t('share_title')}
      className="grid gap-3 rounded-lg border border-sf-border bg-sf-panel px-3 py-3"
    >
      <div className="flex items-center gap-2 text-md font-medium text-sf-primary">
        <IconLink size={14} />
        {t('share_title')}
      </div>
      {children}
    </section>
  );

  if (!shareable) {
    return shell(
      <p className="text-md text-sf-secondary">{t('share_error_unsupported-format')}</p>,
    );
  }

  if (!account) {
    return shell(
      <div className="flex justify-center py-2">
        <Spinner className="size-3.5" />
      </div>,
    );
  }

  if (account.status !== 'signed-in') {
    return shell(
      <>
        <p className="text-md text-sf-secondary">{t('share_signInBody')}</p>
        <div>
          <Button size="sm" variant="secondary" onClick={openDirectorSettings}>
            {t('share_signIn')}
          </Button>
        </div>
      </>,
    );
  }

  if (state.status === 'preparing' || state.status === 'finishing') {
    return shell(
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-md text-sf-secondary">
          <Spinner className="size-3.5 text-sf-border fill-sf-primary" />
          {t(state.status === 'preparing' ? 'share_preparing' : 'share_finishing')}
        </span>
        {state.status === 'preparing' && (
          <Button size="sm" variant="ghost" onClick={() => void window.screenforge.cancelShare()}>
            {t('share_cancel')}
          </Button>
        )}
      </div>,
    );
  }

  if (state.status === 'uploading') {
    const pct =
      state.totalBytes > 0 ? Math.round((state.uploadedBytes / state.totalBytes) * 100) : 0;
    return shell(
      <>
        <div className="flex items-center justify-between text-md">
          <span className="text-sf-secondary">{t('share_uploading')}</span>
          <span className="flex items-center gap-2">
            <span className="tabular-nums text-sf-muted">
              {t('share_uploadedOf', {
                done: formatBytes(state.uploadedBytes),
                total: formatBytes(state.totalBytes),
              })}
            </span>
            <span className="tabular-nums font-medium text-sf-primary">{`${pct}%`}</span>
          </span>
        </div>
        <Progress value={pct} />
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => void window.screenforge.cancelShare()}>
            {t('share_cancel')}
          </Button>
        </div>
      </>,
    );
  }

  if (state.status === 'done') {
    const { link } = state;
    return shell(
      <>
        <p className="text-md font-medium text-sf-green">
          {t(state.copied ? 'share_copied' : 'share_ready')}
        </p>
        {link.watchUrl && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="min-w-0 flex-1 cursor-pointer truncate rounded-md border border-sf-border bg-sf-bg px-2 py-1.5 text-left text-md text-sf-primary underline-offset-2 hover:underline"
              title={link.watchUrl}
              onClick={() => link.watchUrl && window.screenforge.openExternalUrl(link.watchUrl)}
            >
              {link.watchUrl}
            </button>
            <Button size="sm" variant="secondary" onClick={() => void copyLink(link)}>
              <IconCopy size={13} />
              {t('share_copy')}
            </Button>
          </div>
        )}
        <p className="text-sm text-sf-muted">
          <ExpiryText link={link} />
        </p>
      </>,
    );
  }

  const failed = state.status === 'failed' ? state : null;
  const resume = canResume || (failed?.resumable ?? false);
  return shell(
    <>
      {failed ? (
        <p role="alert" className="text-md text-sf-red">
          {t(`share_error_${failed.error}`)}
        </p>
      ) : (
        <p className="text-md text-sf-secondary">{t('share_body')}</p>
      )}
      <p className="text-sm text-sf-muted">{t('share_plan')}</p>
      <div className="flex gap-2">
        {failed?.error === 'signed-out' ? (
          <Button size="sm" onClick={openDirectorSettings}>
            {t('share_signInAgain')}
          </Button>
        ) : failed && FINAL_ERRORS.has(failed.error) ? null : (
          <Button size="sm" className="gap-1.5" onClick={startShare}>
            <IconLink size={13} />
            {resume ? t('share_resume') : failed ? t('share_tryAgain') : t('share_button')}
          </Button>
        )}
      </div>
    </>,
  );
};
