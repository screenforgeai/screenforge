import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconUpload } from 'src/lib/icons';
import { CHANGELOG_URL } from 'src/lib/siteLinks';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from 'src/lib/ui';
import type { UpdaterState } from 'src/types';

type UpdateReadyPromptProps = {
  state: UpdaterState | null;
  isApplying: boolean;
  isChecking: boolean;
  onApply: () => Promise<boolean>;
  onCheckNow: () => Promise<void>;
};

export const UpdateReadyPrompt = ({
  state,
  isApplying,
  isChecking,
  onApply,
  onCheckNow,
}: UpdateReadyPromptProps) => {
  const { t } = useTranslation('update');
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const [dismissedReadyKeys, setDismissedReadyKeys] = useState<string[]>([]);

  const readyKey =
    state?.status === 'ready'
      ? `${state.availableVersion ?? 'unknown'}::${state.releaseNotes ?? ''}`
      : null;

  if (state?.status === 'downloaded') {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 gap-1.5 border border-sf-border px-3 text-sf-secondary"
        disabled
        title={t('downloadingTitle')}
      >
        <IconUpload />
        <span>{t('updateDownloaded')}</span>
      </Button>
    );
  }

  if (state?.status === 'error') {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 gap-1.5 border border-sf-border px-3 hover:border-sf-border-lt"
        disabled={isChecking}
        title={state.errorMessage ?? t('retryUpdate')}
        onClick={() => void onCheckNow()}
      >
        <IconUpload />
        <span>{isChecking ? t('checking') : t('retryUpdate')}</span>
      </Button>
    );
  }

  if (state?.status !== 'ready') {
    return null;
  }

  const open = manuallyOpen || !dismissedReadyKeys.includes(readyKey);
  const versionLabel = state.availableVersion ? `v${state.availableVersion}` : t('newVersion');

  const handleApply = async () => {
    const didStartInstall = await onApply();
    if (didStartInstall) {
      setManuallyOpen(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setManuallyOpen(true);
      return;
    }

    setManuallyOpen(false);
    setDismissedReadyKeys((currentKeys) =>
      currentKeys.includes(readyKey) ? currentKeys : [...currentKeys, readyKey],
    );
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 gap-1.5 border border-sf-border px-3 hover:border-sf-border-lt"
        onClick={() => setManuallyOpen(true)}
      >
        <IconUpload />
        <span>{t('updateReady')}</span>
      </Button>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent
          className="max-w-sm gap-0 overflow-hidden p-0"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.99 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="border-b border-sf-border px-5 py-4">
            <p className="mb-2 text-2xs font-medium uppercase tracking-widest text-sf-muted">
              {t('readyLabel', { version: versionLabel })}
            </p>
            <AlertDialogHeader className="gap-1 space-y-0 text-left">
              <AlertDialogTitle className="text-md font-medium tracking-tight">
                {t('restartWhenDone')}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm leading-5 text-sf-secondary">
                {t('updateDesc', { version: versionLabel })}
              </AlertDialogDescription>
            </AlertDialogHeader>
          </div>

          <div className="border-b border-sf-border px-5 py-3">
            <button
              type="button"
              className="group flex items-center gap-1 text-sm text-sf-secondary transition-colors duration-150 hover:text-sf-primary"
              onClick={() => window.screenforge.openExternalUrl(CHANGELOG_URL)}
            >
              {t('viewChangelog')}
              <span className="text-sf-muted transition-colors duration-150 group-hover:text-sf-primary">
                ↗
              </span>
            </button>
          </div>

          <AlertDialogFooter className="flex flex-row items-center justify-between gap-2 px-5 py-3 sm:flex-row sm:justify-between">
            <p className="text-xs text-sf-muted">{t('staysDownloaded')}</p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={isApplying}
              >
                {t('later')}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleApply()}
                disabled={isApplying}
              >
                {isApplying ? t('preparing') : t('restartAndInstall')}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
