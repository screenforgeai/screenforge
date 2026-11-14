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
import { DirectorInfoTip } from '../Director/DirectorInfoTip';
import { DirectorMark } from '../Director/DirectorMark';
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

  // One row: what it is on the left, the one action on the right; one quiet line below.
  const shell = (body: React.ReactNode, action?: React.ReactNode) => (
    <section
      aria-label={t('share_title')}
      className="grid gap-2 rounded-lg border border-sf-border bg-sf-panel px-3 py-3"
    >
      <div className="flex min-h-8 items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-md font-medium text-sf-primary">
          <IconLink size={14} />
          {t('share_title')}
          <DirectorInfoTip />
        </div>
        {action}
      </div>
      {body}
    </section>
  );
  const note = (text: string) => <p className="text-sm text-sf-muted">{text}</p>;
  const cancelButton = (
    <Button size="sm" variant="ghost" onClick={() => void window.screenforge.cancelShare()}>
      {t('share_cancel')}
    </Button>
  );

  if (!shareable) {
    return shell(note(t('share_error_unsupported-format')));
  }

  if (!account) {
    return shell(null, <Spinner className="size-3.5" />);
  }

  if (account.status !== 'signed-in') {
    return shell(
      note(t('share_signInBody')),
      <Button size="sm" variant="secondary" className="gap-1.5" onClick={openDirectorSettings}>
        <DirectorMark size={13} />
        {t('share_signIn')}
      </Button>,
    );
  }

  if (state.status === 'preparing' || state.status === 'finishing') {
    return shell(
      <span className="flex items-center gap-2 text-sm text-sf-muted">
        <Spinner className="size-3.5 text-sf-border fill-sf-primary" />
        {t(state.status === 'preparing' ? 'share_preparing' : 'share_finishing')}
      </span>,
      state.status === 'preparing' ? cancelButton : undefined,
    );
  }

  if (state.status === 'uploading') {
    const pct =
      state.totalBytes > 0 ? Math.round((state.uploadedBytes / state.totalBytes) * 100) : 0;
    return shell(
      <>
        <Progress value={pct} />
        <div className="flex items-center justify-between text-sm text-sf-muted">
          <span>{t('share_uploading')}</span>
          <span className="flex items-center gap-2 tabular-nums">
            {t('share_uploadedOf', {
              done: formatBytes(state.uploadedBytes),
              total: formatBytes(state.totalBytes),
            })}
            <span className="font-medium text-sf-primary">{`${pct}%`}</span>
          </span>
        </div>
      </>,
      cancelButton,
    );
  }

  if (state.status === 'done') {
    const { link } = state;
    return shell(
      <>
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
      <span className="text-sm font-medium text-sf-green">
        {t(state.copied ? 'share_copied' : 'share_ready')}
      </span>,
    );
  }

  const failed = state.status === 'failed' ? state : null;
  const resume = canResume || (failed?.resumable ?? false);
  const action =
    failed?.error === 'signed-out' ? (
      <Button size="sm" variant="secondary" onClick={openDirectorSettings}>
        {t('share_signInAgain')}
      </Button>
    ) : failed && FINAL_ERRORS.has(failed.error) ? undefined : (
      <Button size="sm" variant="secondary" className="gap-1.5" onClick={startShare}>
        <IconLink size={13} />
        {resume ? t('share_resume') : failed ? t('share_tryAgain') : t('share_button')}
      </Button>
    );
  return shell(
    failed ? (
      <p role="alert" className="text-sm text-sf-red">
        {t(`share_error_${failed.error}`)}
      </p>
    ) : (
      note(t('share_body'))
    ),
    action,
  );
};
