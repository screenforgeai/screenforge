import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { trackEvent } from 'src/lib/analytics';
import { IconPencil } from 'src/lib/icons';
import { cn } from 'src/lib/utils';
import { useShallow } from 'zustand/react/shallow';
import {
  Button,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from '../../lib/ui';
import { useUpdaterState } from '../../hooks/useUpdaterState';
import { useVideoExport } from '../../hooks/useVideoExport';
import { useStore } from '../../store';
import type { ExportSettings } from '../../types';
import ExportModal from '../ExportModal';
import { ShareBackgroundToasts } from '../Share/ShareBackgroundToasts';
import { useShareJob } from '../../hooks/useShareJob';
import { EDITOR_SIDEBAR_WIDTH_CLASS } from '../layout';
import { useProjectPersistence } from '../ProjectPersistenceProvider';
import { ActivityIndicator } from './_components/ActivityIndicator';
import { UpdateReadyPrompt } from './_components/UpdateReadyPrompt';
import { CanvasRatioDropdown } from './_components/CanvasRatioDropdown';
import { StylesDropdown } from './_components/StylesDropdown';
import { KofiModal } from '../WidgetLibrary/_components/KofiModal';
import { incrementExportCount, MILESTONE_EXPORT_COUNT } from '../../lib/feedbackTracking';

type TitlePopoverBodyProps = {
  initialValue: string;
  isSaving: boolean;
  isTitleRequired: boolean;
  existingNames: string[];
  onClose: () => void;
  onSubmit: (value: string) => Promise<boolean>;
};

const TitlePopoverBody = ({
  initialValue,
  isSaving,
  isTitleRequired,
  existingNames,
  onClose,
  onSubmit,
}: TitlePopoverBodyProps) => {
  const { t } = useTranslation('topnav');
  const [draftTitle, setDraftTitle] = useState(initialValue);
  const [titleError, setTitleError] = useState('');

  const handleSubmit = async () => {
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      return;
    }

    if (existingNames.includes(trimmed)) {
      setTitleError(t('error_nameExists'));
      return;
    }

    const didSave = await onSubmit(trimmed);
    if (didSave) {
      onClose();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {isTitleRequired && (
        <div className="space-y-1">
          <div className="text-sm font-medium text-sf-primary">{t('namingRequired_title')}</div>
          <p className="text-xs leading-5 text-sf-secondary">{t('namingRequired_desc')}</p>
        </div>
      )}

      <div className="flex gap-2">
        <div className="w-full">
          <Input
            autoFocus
            value={draftTitle}
            placeholder={isTitleRequired ? t('placeholder_name') : t('placeholder_rename')}
            onChange={(event) => {
              setDraftTitle(event.target.value);
              setTitleError('');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleSubmit();
              }

              if (event.key === 'Escape' && !isTitleRequired) {
                event.preventDefault();
                onClose();
              }
            }}
            className={`w-full border-sf-border bg-sf-bg text-sf-primary focus-visible:ring-0 ${
              titleError
                ? 'border-red-500 focus-visible:border-red-500'
                : 'focus-visible:border-sf-border-lt'
            }`}
          />
          {titleError && <p className="text-xs text-red-400">{titleError}</p>}
        </div>

        <Button
          size="sm"
          className="ml-auto"
          onClick={() => void handleSubmit()}
          disabled={!draftTitle.trim() || isSaving}
        >
          {isSaving ? t('saving') : isTitleRequired ? t('save') : t('update')}
        </Button>
      </div>
    </div>
  );
};

export const TopNav = ({ onOpenFFmpegSetup }: { onOpenFFmpegSetup: () => void }) => {
  const { t } = useTranslation('topnav');
  const [exportOpen, setExportOpen] = useState(false);
  const [milestoneKofiOpen, setMilestoneKofiOpen] = useState(false);
  const [milestoneNumber, setMilestoneNumber] = useState(1);
  // Shown once the export window closes, so it never covers the share link.
  const pendingMilestoneRef = useRef<number | null>(null);
  const shareJob = useShareJob();
  const { t: tExport } = useTranslation('export');
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false);
  const updaterState = useUpdaterState();
  const {
    state: exportState,
    runExport,
    cancelExport,
    reset: resetExport,
    isExporting,
  } = useVideoExport();
  const {
    closeTitleEditor,
    flushPendingSave,
    isSaving,
    isTitleRequired,
    openTitleEditor,
    submitTitle,
    titlePopoverOpen,
  } = useProjectPersistence();

  const { recordingResult, recordingName, currentProjectId, savedProjects } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      recordingName: state.recordingName,
      currentProjectId: state.currentProjectId,
      savedProjects: state.savedProjects,
    })),
  );

  const existingNames = savedProjects
    .filter((project) => project.id !== currentProjectId)
    .map((project) => project.name);

  const showUpdaterActivity = isCheckingForUpdate || updaterState?.status === 'downloading';
  const updaterActivityLabel =
    updaterState?.status === 'downloading'
      ? t('downloadingUpdate')
      : isCheckingForUpdate
        ? t('checkingUpdates')
        : null;

  const handleTitleOpenChange = (open: boolean) => {
    if (open) {
      openTitleEditor();
      return;
    }

    closeTitleEditor();
  };

  const handleExport = async (outputPath: string, settings: ExportSettings) => {
    try {
      await runExport(outputPath, settings);
      new Notification('Export complete', { body: `${recordingName} exported successfully` });
      // The export window stays open on its done view: where the file went, and Share link.

      const count = incrementExportCount();
      if (count % MILESTONE_EXPORT_COUNT === 0) {
        pendingMilestoneRef.current = Math.floor(count / MILESTONE_EXPORT_COUNT);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      if (message.toLowerCase().includes('cancel')) {
        toast(t('toast_exportRunning'));
      } else {
        toast.error(message);
      }
    }
  };

  const handleApplyUpdate = async (): Promise<boolean> => {
    if (isApplyingUpdate) {
      return false;
    }

    setIsApplyingUpdate(true);

    try {
      const didFlush = await flushPendingSave();
      if (!didFlush) {
        if (isTitleRequired) {
          openTitleEditor();
          toast.error(t('toast_nameBeforeUpdate'));
        } else {
          toast.error(t('toast_saveFailed'));
        }
        return false;
      }

      await window.screenforge.restartToApplyUpdate();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not install the update.';
      toast.error(message);
      return false;
    } finally {
      setIsApplyingUpdate(false);
    }
  };

  const handleCheckForUpdates = async (): Promise<void> => {
    if (isCheckingForUpdate) {
      return;
    }

    setIsCheckingForUpdate(true);

    try {
      const nextState = await window.screenforge.checkForUpdatesNow();
      if (nextState.status === 'idle') {
        toast.success(t('toast_upToDate'));
      } else if (nextState.status === 'disabled') {
        toast(t('toast_autoUpdateUnavailable'));
      } else if (nextState.status === 'error') {
        toast.error(nextState.errorMessage ?? t('toast_updateCheckFailed'));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('toast_updateCheckFailed');
      toast.error(message);
    } finally {
      setIsCheckingForUpdate(false);
    }
  };

  return (
    <>
      <nav className="app-drag relative flex h-12 w-full items-center border-b border-sf-border px-4">
        <div className="app-no-drag ml-[68px] flex items-center">
          <StylesDropdown />
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 flex items-center justify-center">
          <div className="app-no-drag pointer-events-auto">
            <Popover open={titlePopoverOpen} onOpenChange={handleTitleOpenChange}>
              <PopoverAnchor asChild>
                {recordingResult ? (
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'app-no-drag group flex min-w-0 max-w-full items-center justify-self-center gap-1.5 rounded-full border px-2 py-1 transition-[border-color,background-color,box-shadow,color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                        isTitleRequired
                          ? 'border-sf-border-lt bg-sf-panel pr-1.5 text-sf-primary shadow-[0_1px_1px_rgba(0,0,0,0.16),0_10px_26px_rgba(0,0,0,0.26)]'
                          : 'border-transparent text-sf-primary hover:border-sf-border-lt hover:bg-sf-panel/80',
                      )}
                      aria-label={isTitleRequired ? t('ariaNameNew') : t('ariaEditTitle')}
                    >
                      <span
                        className={cn(
                          'max-w-[26rem] truncate text-md font-medium',
                          recordingResult ? 'text-sf-primary' : 'text-sf-secondary',
                        )}
                        title={recordingName}
                      >
                        {recordingName}
                      </span>

                      <span
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-full transition-colors',
                          isTitleRequired
                            ? 'bg-secondary text-sf-primary shadow-sm'
                            : 'text-sf-muted group-hover:text-sf-primary',
                        )}
                        aria-hidden="true"
                      >
                        <IconPencil size={13} />
                      </span>
                    </button>
                  </PopoverTrigger>
                ) : (
                  <div className="flex min-w-0 max-w-full items-center justify-self-center gap-1.5">
                    <span className="max-w-[26rem] truncate text-md font-medium text-sf-secondary">
                      {recordingName}
                    </span>
                  </div>
                )}
              </PopoverAnchor>

              <PopoverContent
                side="bottom"
                align="center"
                sideOffset={10}
                className={cn(
                  'w-70 p-3 text-sf-primary shadow-2xl',
                  isTitleRequired
                    ? 'border-sf-border-lt bg-sf-panel shadow-[0_1px_1px_rgba(0,0,0,0.2),0_18px_48px_rgba(0,0,0,0.34)]'
                    : 'border-sf-border bg-sf-panel',
                )}
                onEscapeKeyDown={(event) => {
                  if (isTitleRequired) {
                    event.preventDefault();
                  }
                }}
                onPointerDownOutside={(event) => {
                  if (isTitleRequired) {
                    event.preventDefault();
                  }
                }}
                onFocusOutside={(event) => {
                  if (isTitleRequired) {
                    event.preventDefault();
                  }
                }}
                onInteractOutside={(event) => {
                  if (isTitleRequired) {
                    event.preventDefault();
                  }
                }}
              >
                <TitlePopoverBody
                  key={`${currentProjectId ?? 'new'}:${recordingName}:${titlePopoverOpen ? 'open' : 'closed'}`}
                  initialValue={recordingName}
                  isSaving={isSaving}
                  isTitleRequired={isTitleRequired}
                  existingNames={existingNames}
                  onClose={closeTitleEditor}
                  onSubmit={submitTitle}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="app-drag ml-auto flex min-w-0 items-center justify-end">
          <div className="app-no-drag flex items-center gap-2">
            {recordingResult && !isTitleRequired && (
              <ActivityIndicator label={t('autosaving')} visible={isSaving} />
            )}
            {showUpdaterActivity && (
              <ActivityIndicator
                label={updaterActivityLabel ?? ''}
                minWidthClassName="min-w-[196px]"
              />
            )}
            <UpdateReadyPrompt
              state={updaterState}
              isApplying={isApplyingUpdate}
              isChecking={isCheckingForUpdate}
              onApply={handleApplyUpdate}
              onCheckNow={handleCheckForUpdates}
            />
            {isExporting && (
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() => setExportOpen(true)}
              >
                <Spinner className="size-3 shrink-0 text-sf-border fill-sf-primary" />
                <span className="text-sf-secondary">{t('exporting')}</span>
                <span className="tabular-nums font-medium text-sf-primary">
                  {Math.round(exportState.progress * 100)}%
                </span>
              </Button>
            )}
            <CanvasRatioDropdown />
            <Button
              size="sm"
              className="gap-1.5 py-1"
              disabled={!recordingResult || isExporting}
              onClick={() => setExportOpen(true)}
            >
              {t('export')}
            </Button>
          </div>
        </div>
      </nav>

      <ExportModal
        open={exportOpen}
        recordingName={recordingName}
        exportState={exportState}
        onClose={() => {
          setExportOpen(false);
          if (isExporting) {
            toast(t('toast_exportRunning'));
          } else {
            resetExport();
          }
          if (
            shareJob.status === 'preparing' ||
            shareJob.status === 'uploading' ||
            shareJob.status === 'finishing'
          ) {
            toast(tExport('share_backgroundUploading'));
          }
          const milestone = pendingMilestoneRef.current;
          if (milestone !== null) {
            pendingMilestoneRef.current = null;
            trackEvent('milestone_kofi_shown', {
              export_count: milestone * MILESTONE_EXPORT_COUNT,
              milestone,
            });
            setMilestoneNumber(milestone);
            setMilestoneKofiOpen(true);
          }
        }}
        onCancelExport={cancelExport}
        onExport={handleExport}
        onOpenFFmpegSetup={onOpenFFmpegSetup}
      />

      <ShareBackgroundToasts quiet={exportOpen} />

      <KofiModal
        open={milestoneKofiOpen}
        milestoneNumber={milestoneNumber}
        onClose={() => setMilestoneKofiOpen(false)}
      />
    </>
  );
};
