import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { IconFolder, IconVideoOff, IconTrash, IconMoreVertical } from 'src/lib/icons';
import { motion } from 'motion/react';
import { useStore } from '../../../store';
import { cn, formatDate, formatTime } from 'src/lib/utils';
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'src/lib/ui';
import { Button as ButtonWrapper } from 'src/lib/ui/components/primitives/button';
import { toast } from 'sonner';
import ConfirmModal from 'src/components/ConfirmModal';
import { useNewRecordingFlow } from '../_hooks/useNewRecordingFlow';
import { trackEvent } from 'src/lib/analytics';
import { useProjectPersistence } from 'src/components/ProjectPersistenceProvider';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
} from 'src/components/layout';

const RECORDING_LAYOUT_TRANSITION = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.9,
} as const;

export const RecordingWidget = () => {
  const { t } = useTranslation('recordings');
  const {
    discardPendingSave,
    flushPendingSave,
    hasUnsavedChanges,
    isSaving,
    isTitleRequired,
    openTitleEditor,
    setLoadedProject,
  } = useProjectPersistence();
  const { showUnsavedWarning, setShowUnsavedWarning, discardAndOpenNewRecording } =
    useNewRecordingFlow();

  const { savedProjects, recordingName, recordingResult, currentProjectId } = useStore(
    useShallow((s) => ({
      savedProjects: s.savedProjects,
      recordingName: s.recordingName,
      recordingResult: s.recordingResult,
      currentProjectId: s.currentProjectId,
    })),
  );

  const { setSavedProjects, loadProjectSession, resetEditorSession } = useStore(
    useShallow((s) => ({
      setSavedProjects: s.setSavedProjects,
      loadProjectSession: s.loadProjectSession,
      resetEditorSession: s.resetEditorSession,
    })),
  );

  const projectDurations = useMemo(
    () =>
      new Map(
        savedProjects.map((p) => [
          p.id,
          p.mediaSegments && p.mediaSegments.length > 0
            ? p.mediaSegments.reduce((max, seg) => Math.max(max, seg.timelineEnd), 0)
            : p.result.duration,
        ]),
      ),
    [savedProjects],
  );

  const applyProject = (project: (typeof savedProjects)[number]) => {
    loadProjectSession(project);
    setLoadedProject(project);
  };

  const handleLoad = async (project: (typeof savedProjects)[number]) => {
    if (project.id === currentProjectId) {
      return;
    }

    if (isTitleRequired) {
      openTitleEditor();
      toast(t('addTitleFirst'));
      return;
    }

    if ((hasUnsavedChanges || isSaving) && currentProjectId !== project.id) {
      const didFlush = await flushPendingSave();
      if (!didFlush) {
        return;
      }
    }

    applyProject(project);
    trackEvent('project_opened');
  };

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const pendingProject = savedProjects.find((p) => p.id === pendingDeleteId);

  const handleDelete = async () => {
    if (!pendingDeleteId) {
      return;
    }

    if (currentProjectId === pendingDeleteId && (hasUnsavedChanges || isSaving)) {
      const didFlush = await flushPendingSave();
      if (!didFlush) {
        return;
      }
    }

    const remaining = savedProjects.filter((p) => p.id !== pendingDeleteId);
    setSavedProjects(remaining);

    if (currentProjectId === pendingDeleteId) {
      const next = remaining[0] ?? null;
      if (next) {
        applyProject(next);
      } else {
        discardPendingSave();
        resetEditorSession();
      }
    }

    await window.screenforge.deleteProject(pendingDeleteId);
    trackEvent('project_deleted');
    setPendingDeleteId(null);
  };

  const handleDeleteAll = async () => {
    setIsDeletingAll(true);
    discardPendingSave();
    resetEditorSession();
    for (const project of savedProjects) {
      await window.screenforge.deleteProject(project.id);
    }
    setSavedProjects([]);
    setIsDeletingAll(false);
    setShowDeleteAll(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div className={`${WIDGET_PANEL_HEADER_CLASS} justify-between pr-2`}>
        <div className="flex items-center gap-2">
          <IconFolder className="size-4.5" />
          {t('header')}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={t('moreActions')}>
              <IconMoreVertical size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4}>
            <DropdownMenuItem
              className="gap-2"
              onClick={() => void window.screenforge.openProjectBundleFromDisk()}
            >
              {t('openProject')}
            </DropdownMenuItem>
            {savedProjects.length > 0 && (
              <DropdownMenuItem
                className="gap-2 text-red-300 focus:bg-red-500/15 focus:text-red-100"
                onClick={() => setShowDeleteAll(true)}
              >
                {t('deleteAll')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <motion.div
        layout
        layoutScroll
        className={cn(
          'flex-1 overflow-y-auto px-3 pb-6 grid-cols-1',
          savedProjects.length === 0 ? 'flex flex-col' : 'grid auto-rows-max gap-3',
        )}
        transition={RECORDING_LAYOUT_TRANSITION}
      >
        {savedProjects.length === 0 && (
          <div className={WIDGET_EMPTY_STATE_CLASS}>
            <IconVideoOff size={34} className="text-sf-muted" />
            <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noSaved')}</div>
          </div>
        )}

        {savedProjects.map((project) => {
          const isActive =
            recordingResult?.filePath === project.result.filePath && recordingName === project.name;

          return (
            <ContextMenu key={project.id}>
              <ContextMenuTrigger asChild>
                <ButtonWrapper
                  asChild
                  hoverScale={1}
                  tapScale={0.98}
                  onClick={() => void handleLoad(project)}
                  onKeyDown={(event) => {
                    if (event.currentTarget !== event.target) {
                      return;
                    }
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      void handleLoad(project);
                    }
                  }}
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                >
                  <motion.div
                    layout
                    transition={RECORDING_LAYOUT_TRANSITION}
                    className={cn(
                      'group shrink-0 overflow-hidden rounded-md border border-sf-border bg-sf-panel text-left transition-[border-color,box-shadow,background-color] hover:border-sf-border-lt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-border-lt',
                      isActive &&
                        'shadow-[0_0_0_1px_var(--color-sf-border-lt),0_10px_28px_rgba(0,0,0,0.22)]',
                    )}
                  >
                    {/* Thumbnail */}
                    <motion.div
                      layout
                      transition={RECORDING_LAYOUT_TRANSITION}
                      className={cn(
                        'group relative overflow-hidden bg-[#0d0d10] w-full',
                        isActive && 'bg-[#10151c]',
                      )}
                      style={{ aspectRatio: '16 / 9' }}
                    >
                      {project.thumbnail ? (
                        <img
                          src={project.thumbnail}
                          alt={project.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-full h-full"
                          style={{
                            background: `radial-gradient(ellipse at 30% 40%, hsla(220, 50%, 20%, 0.6) 0%, #0d0d10 70%)`,
                          }}
                        />
                      )}

                      {/* Delete button */}
                      <button
                        aria-label={t('ariaDeleteRecording', { name: project.name })}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteId(project.id);
                        }}
                        className="cursor-pointer absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-sm border border-white/10 bg-[#1a1a1f] text-white/40 opacity-0 transition-[opacity,transform,color,background-color] duration-150 group-hover:opacity-100 hover:border-red-500/30 hover:bg-red-950 hover:text-red-400 active:scale-95 active:bg-red-900"
                      >
                        <IconTrash size={12} />
                      </button>
                    </motion.div>

                    {/* Metadata */}
                    <motion.div
                      layout
                      transition={RECORDING_LAYOUT_TRANSITION}
                      className="border-sf-border bg-[#181818] grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t px-2.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="truncate font-medium text-sf-primary text-md">
                            {project.name}
                          </div>
                          {isActive && (
                            <span className="shrink-0 rounded-full bg-[#088a3b] text-primary-foreground px-2 py-0.5 text-xs font-medium uppercase tracking-[0.12em]">
                              {t('active')}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-sf-secondary text-sm">
                          {formatDate(project.savedAt)}
                        </div>
                      </div>
                      <div className="shrink-0 tabular-nums text-sf-secondary text-xs">
                        {formatTime(projectDurations.get(project.id) ?? project.result.duration)}
                      </div>
                    </motion.div>
                  </motion.div>
                </ButtonWrapper>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem
                  className="text-red-300 focus:bg-red-500/15 focus:text-red-100"
                  onClick={() => setPendingDeleteId(project.id)}
                >
                  {t('delete')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </motion.div>

      <ConfirmModal
        open={showUnsavedWarning}
        title={t('unsavedRecording_title', { ns: 'widgets' })}
        description={t('unsavedRecording_desc', { ns: 'widgets' })}
        confirmText={t('discard', { ns: 'widgets' })}
        variant="destructive"
        onConfirm={discardAndOpenNewRecording}
        onCancel={() => setShowUnsavedWarning(false)}
      />

      <ConfirmModal
        open={pendingDeleteId !== null}
        title={t('deleteTitle')}
        description={<>{t('deleteDesc', { name: pendingProject?.name ?? '' })}</>}
        onConfirm={handleDelete}
        onCancel={() => setPendingDeleteId(null)}
        confirmText={t('delete')}
        variant="destructive"
      />

      <ConfirmModal
        open={showDeleteAll}
        title={t('deleteAllTitle')}
        description={t('deleteAllDesc')}
        onConfirm={handleDeleteAll}
        onCancel={() => setShowDeleteAll(false)}
        confirmText={t('deleteAllConfirm')}
        variant="destructive"
        loading={isDeletingAll}
      />
    </div>
  );
};
