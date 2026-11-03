import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from 'src/store';
import type { Scene } from 'src/store';
import { IconFilm, IconFolderOpen, IconPlus, IconTrash, IconX } from 'src/lib/icons';
import { Button, Dialog, DialogContent, DialogTitle, Input } from 'src/lib/ui';
import { cn } from 'src/lib/utils';
import { useNewRecordingFlow } from '../_hooks/useNewRecordingFlow';
import ConfirmModal from 'src/components/ConfirmModal';

// ─── Draft persistence ────────────────────────────────────────────────────────

const DRAFTS_KEY = 'sf:scene-drafts';

interface SceneDraft {
  id: string;
  title: string;
  savedAt: number;
  scenes: Scene[];
}

function loadDrafts(): SceneDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    return raw ? (JSON.parse(raw) as SceneDraft[]) : [];
  } catch {
    return [];
  }
}

function persistDrafts(drafts: SceneDraft[]): void {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

function saveDraft(title: string, scenes: Scene[]): void {
  const drafts = loadDrafts();
  drafts.unshift({ id: crypto.randomUUID(), title: title.trim(), savedAt: Date.now(), scenes });
  persistDrafts(drafts);
}

function deleteDraftById(id: string): SceneDraft[] {
  const next = loadDrafts().filter((d) => d.id !== id);
  persistDrafts(next);
  return next;
}

function formatRelativeTime(
  ts: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) {
    return t('scenes_justNow');
  }
  if (diffMin < 60) {
    return t('scenes_minutesAgo', { n: diffMin });
  }
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) {
    return t('scenes_hoursAgo', { n: diffH });
  }
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) {
    return t('scenes_daysAgo', { n: diffD });
  }
  return new Date(ts).toLocaleDateString();
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onStartRecording: () => void;
}

interface SceneFormData {
  title: string;
  context: string;
  duration: string;
  script: string;
  notes: string;
}

const emptyForm: SceneFormData = { title: '', context: '', duration: '', script: '', notes: '' };

const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const parseDuration = (duration: string): { min: number; sec: number } => {
  if (!duration) {
    return { min: 0, sec: 0 };
  }
  const minMatch = duration.match(/(\d+)m/);
  const secMatch = duration.match(/(\d+)s/);
  return {
    min: minMatch ? parseInt(minMatch[1]) : 0,
    sec: secMatch ? parseInt(secMatch[1]) : 0,
  };
};

const textareaClass =
  'placeholder:text-sf-muted w-full resize-none rounded-lg border border-sf-border bg-sf-panel px-3 py-2 text-md font-medium tracking-[-0.01em] leading-relaxed text-sf-primary outline-none transition-[border-color] focus:border-sf-border-lt';

const labelClass = 'block text-md font-medium text-sf-secondary';

// ─── Save Draft Dialog ────────────────────────────────────────────────────────

const SaveDraftDialog = ({
  open,
  onSave,
  onCancel,
}: {
  open: boolean;
  onSave: (title: string) => void;
  onCancel: () => void;
}) => {
  const { t } = useTranslation('recordings');
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (!title.trim()) {
      return;
    }
    onSave(title.trim());
    setTitle('');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onCancel();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        className="flex w-full max-w-[360px] sm:max-w-[360px] flex-col gap-0 overflow-hidden rounded-xl border border-sf-border bg-sf-bg p-0 shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-sf-border px-5 py-4">
          <DialogTitle className="text-base font-semibold tracking-tight text-sf-primary">
            {t('scenes_saveDraft_title')}
          </DialogTitle>
          <Button variant="ghost" size="icon-sm" onClick={onCancel} className="shrink-0">
            <IconX size={14} />
          </Button>
        </div>

        <div className="flex flex-col gap-1.5 px-5 py-4">
          <label className="text-xs font-medium text-sf-secondary">{t('scenes_planName')}</label>
          <Input
            ref={inputRef}
            filled
            placeholder={t('scenes_planNamePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSave();
              }
              if (e.key === 'Escape') {
                onCancel();
              }
            }}
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-sf-border bg-sf-panel/30 px-5 py-3">
          <Button variant="outline" size="sm" onClick={onCancel} className="border-sf-border">
            {t('scenes_cancel')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!title.trim()}>
            {t('scenes_save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Drafts View ──────────────────────────────────────────────────────────────

const DraftsView = ({
  drafts,
  hasCurrentScenes,
  onLoad,
  onDelete,
  onNewPlan,
  onContinue,
}: {
  drafts: SceneDraft[];
  hasCurrentScenes: boolean;
  onLoad: (draft: SceneDraft) => void;
  onDelete: (id: string) => void;
  onNewPlan: () => void;
  onContinue: () => void;
}) => {
  const { t } = useTranslation('recordings');
  return (
    <motion.div
      key="drafts"
      className="flex w-full flex-col"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Draft list */}
      <div className="max-h-[400px] divide-y divide-sf-border/60 overflow-y-auto">
        {drafts.map((draft, i) => (
          <motion.div
            key={draft.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14, delay: i * 0.04 }}
            className="group flex items-center gap-3.5 px-5 py-3.5 transition-colors duration-150 hover:bg-white/[0.018]"
          >
            {/* Icon tile */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sf-border/70 bg-sf-panel text-sf-muted/60">
              <IconFilm size={14} />
            </div>

            {/* Text */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-tight text-sf-primary">
                {draft.title}
              </p>
              <p className="mt-0.5 text-[11.5px] text-sf-muted">
                <span className="tabular-nums">
                  {t('scenes_sceneCount', { count: draft.scenes.length })}
                </span>
                <span className="mx-1.5 opacity-30">·</span>
                {formatRelativeTime(draft.savedAt, t)}
              </p>
            </div>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onLoad(draft)}
                aria-label={t('scenes_loadDraft_aria')}
                className="text-sf-muted/60 transition-all duration-150 hover:text-sf-primary"
              >
                <IconFolderOpen size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onDelete(draft.id)}
                aria-label={t('scenes_deleteDraft_aria')}
                className="text-sf-muted opacity-0 transition-all duration-150 group-hover:opacity-50 hover:!opacity-100 hover:!text-sf-red"
              >
                <IconTrash size={13} />
              </Button>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-sf-border bg-sf-panel/30 px-5 py-3">
        {hasCurrentScenes ? (
          <button
            onClick={onContinue}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-sf-muted transition-colors duration-150 hover:text-sf-secondary"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M7.5 2.5L4 6L7.5 9.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t('scenes_continueCurrent')}
          </button>
        ) : (
          <div />
        )}
        <Button size="sm" onClick={onNewPlan} className="gap-1.5">
          <IconPlus size={11} />
          {t('scenes_newPlan')}
        </Button>
      </div>
    </motion.div>
  );
};

// ─── Scene Add / Edit Modal ───────────────────────────────────────────────────

const SceneAddModal = ({
  open,
  mode,
  scene,
  sceneNumber,
  insertAfterTitle,
  onClose,
  onSave,
}: {
  open: boolean;
  mode: 'add' | 'edit';
  scene?: Scene;
  sceneNumber: number;
  insertAfterTitle?: string;
  onClose: () => void;
  onSave: (data: SceneFormData) => void;
}) => {
  const { t } = useTranslation('recordings');
  const [form, setForm] = useState<SceneFormData>(() =>
    scene
      ? {
          title: scene.title,
          context: scene.context,
          duration: scene.duration ?? '',
          script: scene.script ?? '',
          notes: scene.notes ?? '',
        }
      : emptyForm,
  );
  const [durationMin, setDurationMin] = useState(() => parseDuration(scene?.duration ?? '').min);
  const [durationSec, setDurationSec] = useState(() => parseDuration(scene?.duration ?? '').sec);
  const titleRef = useRef<HTMLInputElement>(null);

  const adjustDuration = (delta: number) => setDurationMin((p) => Math.max(0, p + delta));
  const adjustSec = (delta: number) => setDurationSec((p) => Math.min(59, Math.max(0, p + delta)));

  const wordCount = countWords(form.script);
  const estimatedSeconds = Math.round((wordCount / 150) * 60);
  const estimatedLabel =
    estimatedSeconds >= 60
      ? `~${Math.round(estimatedSeconds / 60)}m`
      : estimatedSeconds > 0
        ? `~${estimatedSeconds}s`
        : '~0s';

  const buildDuration = () => {
    if (durationMin === 0 && durationSec === 0) {
      return '';
    }
    if (durationMin === 0) {
      return `${durationSec}s`;
    }
    if (durationSec === 0) {
      return `${durationMin}m`;
    }
    return `${durationMin}m ${durationSec}s`;
  };

  const handleSave = () => {
    if (!form.title.trim()) {
      titleRef.current?.focus();
      return;
    }
    onSave({ ...form, duration: buildDuration() });
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!form.title.trim()) {
          titleRef.current?.focus();
          return;
        }
        let dur = '';
        if (durationMin > 0 && durationSec > 0) {
          dur = `${durationMin}m ${durationSec}s`;
        } else if (durationMin > 0) {
          dur = `${durationMin}m`;
        } else if (durationSec > 0) {
          dur = `${durationSec}s`;
        }
        onSave({ ...form, duration: dur });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, form, durationMin, durationSec, onSave]);

  const subtitle =
    mode === 'edit'
      ? t('scenes_sceneN', { n: sceneNumber })
      : insertAfterTitle
        ? t('scenes_insertingAfter', { title: insertAfterTitle })
        : t('scenes_firstScene');

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          titleRef.current?.focus();
        }}
        className="flex w-full max-w-[480px] sm:max-w-[480px] flex-col gap-0 overflow-hidden rounded-xl border border-sf-border bg-sf-bg p-0 shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-sf-border px-6 pt-5 pb-4">
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-semibold tracking-widest text-sf-muted">{subtitle}</p>
            <DialogTitle className="text-xl font-semibold tracking-tight text-sf-primary">
              {mode === 'add' ? t('scenes_addScene') : t('scenes_editScene')}
            </DialogTitle>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="mt-0.5 shrink-0">
            <IconX size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-4">
            {/* Title — use Input component with built-in label */}
            <Input
              ref={titleRef}
              filled
              label={t('scenes_sceneTitle')}
              placeholder={t('scenes_namePlaceholder')}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  onClose();
                }
              }}
            />

            {/* Description */}
            <div>
              <label className={cn(labelClass, 'mb-1')}>{t('scenes_description')}</label>
              <textarea
                placeholder={t('scenes_descPlaceholder')}
                value={form.context}
                onChange={(e) => setForm((f) => ({ ...f, context: e.target.value }))}
                rows={3}
                className={textareaClass}
              />
            </div>

            {/* Duration counter */}
            <div>
              <label className={cn(labelClass, 'mb-1.5')}>{t('scenes_duration')}</label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => adjustDuration(-1)}
                    disabled={durationMin === 0}
                    className="border-sf-border text-sf-secondary"
                  >
                    −
                  </Button>
                  <input
                    type="number"
                    min={0}
                    value={durationMin === 0 ? '' : durationMin}
                    placeholder="0"
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setDurationMin(isNaN(val) || val < 0 ? 0 : val);
                    }}
                    className="placeholder:text-sf-muted/50 h-9 w-14 rounded-md border border-sf-border bg-sf-panel px-2 text-center text-sm text-sf-primary outline-none transition-[border-color] focus:border-sf-border-lt [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => adjustDuration(1)}
                    className="border-sf-border text-sf-secondary"
                  >
                    +
                  </Button>
                  <span className="text-sm text-sf-muted">{t('scenes_durationMin')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => adjustSec(-1)}
                    disabled={durationSec === 0}
                    className="border-sf-border text-sf-secondary"
                  >
                    −
                  </Button>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={durationSec === 0 ? '' : durationSec}
                    placeholder="0"
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setDurationSec(isNaN(val) || val < 0 ? 0 : Math.min(59, val));
                    }}
                    className="placeholder:text-sf-muted/50 h-9 w-14 rounded-md border border-sf-border bg-sf-panel px-2 text-center text-sm text-sf-primary outline-none transition-[border-color] focus:border-sf-border-lt [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => adjustSec(1)}
                    disabled={durationSec === 59}
                    className="border-sf-border text-sf-secondary"
                  >
                    +
                  </Button>
                  <span className="text-sm text-sf-muted">{t('scenes_durationSec')}</span>
                </div>
              </div>
            </div>

            {/* Script */}
            <div>
              <div className="mb-1.5">
                <label className={labelClass}>{t('scenes_script')}</label>
              </div>
              <textarea
                placeholder={t('scenes_scriptPlaceholder')}
                value={form.script}
                onChange={(e) => setForm((f) => ({ ...f, script: e.target.value }))}
                rows={3}
                className={textareaClass}
              />
              <p className="mt-1.5 font-mono text-[11px] text-sf-muted/50">
                {t('scenes_wordCount', { count: wordCount })} · {estimatedLabel}{' '}
                {t('scenes_normalPace')}
              </p>
            </div>

            {/* Notes */}
            <div>
              <div className="mb-1.5">
                <label className={labelClass}>{t('scenes_notes')}</label>
              </div>
              <textarea
                placeholder={t('scenes_notesPlaceholder')}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className={textareaClass}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-sf-border bg-sf-panel/30 px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose} className="border-sf-border">
            {t('scenes_cancel')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!form.title.trim()}>
            {mode === 'add' ? t('scenes_addScene') : t('scenes_saveChanges')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Drag Handle ─────────────────────────────────────────────────────────────

const DragHandle = ({
  listeners,
  dragRef,
}: {
  listeners?: Record<string, unknown>;
  dragRef?: (el: HTMLElement | null) => void;
}) => (
  <div
    ref={dragRef}
    {...listeners}
    className="flex shrink-0 cursor-grab flex-col gap-[3.5px] touch-none opacity-25 transition-opacity group-hover:opacity-50 active:cursor-grabbing"
    onClick={(e) => e.stopPropagation()}
  >
    {[0, 1, 2].map((r) => (
      <div key={r} className="flex gap-[3.5px]">
        {[0, 1].map((c) => (
          <div key={c} className="h-[3px] w-[3px] rounded-full bg-sf-secondary" />
        ))}
      </div>
    ))}
  </div>
);

// ─── Scene Row ────────────────────────────────────────────────────────────────

const SceneRow = ({
  scene,
  index,
  isDragging,
  dragListeners,
  dragHandleRef,
  rowRef,
  rowStyle,
  onEdit,
  onDelete,
}: {
  scene: Scene;
  index: number;
  isDragging?: boolean;
  dragListeners?: Record<string, unknown>;
  dragHandleRef?: (el: HTMLElement | null) => void;
  rowRef?: (el: HTMLElement | null) => void;
  rowStyle?: React.CSSProperties;
  onEdit: (scene: Scene) => void;
  onDelete: (id: string) => void;
}) => {
  const { t } = useTranslation('recordings');
  return (
    <div
      ref={rowRef}
      style={rowStyle}
      className={cn(
        'group flex items-center gap-3.5 border-b border-sf-border px-5 py-3.5 last:border-b-0 transition-colors',
        isDragging ? 'opacity-40 bg-sf-panel/50' : 'hover:bg-white/[0.02]',
      )}
    >
      <DragHandle listeners={dragListeners} dragRef={dragHandleRef} />

      <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-sf-muted">
        {String(index + 1).padStart(2, '0')}
      </span>

      <button onClick={() => onEdit(scene)} className="min-w-0 flex-1 cursor-pointer text-left">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium leading-snug text-sf-primary">
            {scene.title}
          </span>
        </div>
        <div className="mt-0.5">
          <span className="truncate text-xs leading-relaxed text-sf-secondary">
            {scene.context || '-'}
          </span>
        </div>
      </button>

      <div
        className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onDelete(scene.id)}
          aria-label={t('scenes_deleteScene_aria')}
        >
          <IconTrash />
        </Button>
      </div>
    </div>
  );
};

const SortableSceneRow = (
  props: Omit<
    React.ComponentProps<typeof SceneRow>,
    'isDragging' | 'dragListeners' | 'dragHandleRef' | 'rowRef' | 'rowStyle'
  >,
) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.scene.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div {...attributes}>
      <SceneRow
        {...props}
        isDragging={isDragging}
        dragListeners={listeners as Record<string, unknown>}
        dragHandleRef={setActivatorNodeRef}
        rowRef={setNodeRef}
        rowStyle={style}
      />
    </div>
  );
};

// ─── Main Modal ───────────────────────────────────────────────────────────────

type ModalView = 'drafts' | 'scenes';

export const CreateScenesModal = ({ open, onClose, onStartRecording }: Props) => {
  const { t } = useTranslation('recordings');
  const { showUnsavedWarning, setShowUnsavedWarning, discardAndOpenNewRecording } =
    useNewRecordingFlow();

  const { scenes, setScenes, addScene, updateScene, deleteScene, reorderScenes } = useStore(
    useShallow((s) => ({
      scenes: s.scenes,
      setScenes: s.setScenes,
      addScene: s.addScene,
      updateScene: s.updateScene,
      deleteScene: s.deleteScene,
      reorderScenes: s.reorderScenes,
    })),
  );

  const sorted = [...scenes].sort((a, b) => a.order - b.order);

  const [view, setView] = useState<ModalView>('scenes');
  const [drafts, setDrafts] = useState<SceneDraft[]>([]);
  const [saveDraftOpen, setSaveDraftOpen] = useState(false);
  const [confirmLoadDraft, setConfirmLoadDraft] = useState<SceneDraft | null>(null);

  const [formState, setFormState] = useState<{
    open: boolean;
    scene: Scene | null;
    addKey: number;
  }>({ open: false, scene: null, addKey: 0 });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Respond to modal opening in the render phase (React's recommended pattern for prop-driven
  // state adjustments that read from external sources like localStorage).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      const saved = loadDrafts();
      setDrafts(saved);
      setView(saved.length > 0 ? 'drafts' : 'scenes');
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const fromIndex = sorted.findIndex((s) => s.id === active.id);
    const toIndex = sorted.findIndex((s) => s.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) {
      reorderScenes(fromIndex, toIndex);
    }
  };

  const handleFormSave = (data: SceneFormData) => {
    if (formState.scene) {
      updateScene(formState.scene.id, {
        title: data.title,
        context: data.context,
        duration: data.duration || undefined,
        script: data.script || undefined,
        notes: data.notes || undefined,
      });
    } else {
      addScene({
        title: data.title,
        context: data.context,
        duration: data.duration || undefined,
        script: data.script || undefined,
        notes: data.notes || undefined,
      });
    }
    setFormState((s) => ({ open: false, scene: null, addKey: s.addKey }));
  };

  const handleSaveDraft = (title: string) => {
    saveDraft(title, sorted);
    setDrafts(loadDrafts());
    setSaveDraftOpen(false);
  };

  const handleLoadDraft = (draft: SceneDraft) => {
    if (scenes.length > 0) {
      setConfirmLoadDraft(draft);
      return;
    }
    setScenes(draft.scenes.map((s, i) => ({ ...s, order: i })));
    setView('scenes');
  };

  const handleConfirmLoad = () => {
    if (!confirmLoadDraft) {
      return;
    }
    setScenes(confirmLoadDraft.scenes.map((s, i) => ({ ...s, order: i })));
    setConfirmLoadDraft(null);
    setView('scenes');
  };

  const handleDeleteDraft = (id: string) => {
    const next = deleteDraftById(id);
    setDrafts(next);
    if (next.length === 0) {
      setView('scenes');
    }
  };

  const handleNewPlan = () => {
    setScenes([]);
    setView('scenes');
  };

  const isEmpty = scenes.length === 0;
  const lastScene = sorted[sorted.length - 1];
  const formSceneNumber = formState.scene ? (formState.scene.order ?? 0) + 1 : scenes.length + 1;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            onClose();
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          className={cn(
            'flex w-full max-w-[700px] sm:max-w-[700px] flex-col gap-0 overflow-hidden rounded-xl border border-sf-border bg-sf-bg p-0 shadow-2xl',
            !isEmpty && view === 'scenes' ? 'h-[86vh] max-h-[780px]' : 'min-h-[520px]',
          )}
        >
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between border-b border-sf-border px-6 pt-5 pb-4">
            <div className="flex flex-col gap-0.5">
              <p className="text-xs font-semibold tracking-widest text-sf-muted">
                {view === 'drafts' ? t('scenes_scenePlans') : t('scenes_beforeRecord')}
              </p>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-xl font-semibold tracking-tight text-sf-primary">
                  {view === 'drafts' ? t('scenes_yourDrafts') : t('scenes_mapScenes')}
                </DialogTitle>
                {view === 'drafts' && (
                  <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-sf-border px-1.5 font-mono text-[11px] font-medium text-sf-secondary">
                    {drafts.length}
                  </span>
                )}
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} className="mt-0.5 shrink-0">
              <IconX size={14} />
            </Button>
          </div>

          {/* Body */}
          <div className="flex min-h-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              {view === 'drafts' ? (
                <DraftsView
                  key="drafts"
                  drafts={drafts}
                  hasCurrentScenes={scenes.length > 0}
                  onLoad={handleLoadDraft}
                  onDelete={handleDeleteDraft}
                  onNewPlan={handleNewPlan}
                  onContinue={() => setView('scenes')}
                />
              ) : (
                <motion.div
                  key="scenes"
                  className="flex w-full flex-1 flex-col"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                >
                  {isEmpty ? (
                    <div className="flex w-full flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                      <IconFilm size={34} className="text-sf-muted" />
                      <div className="flex flex-col gap-1">
                        <p className="text-lg font-medium text-sf-primary/90">
                          {t('scenes_noScenesYet')}
                        </p>
                        <p className="text-sm text-sf-muted">{t('scenes_noSceneDesc')}</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-1"
                        onClick={() =>
                          setFormState((s) => ({ open: true, scene: null, addKey: s.addKey + 1 }))
                        }
                      >
                        <IconPlus size={12} />
                        {t('scenes_addScene')}
                      </Button>
                    </div>
                  ) : (
                    <>
                      {/* Draft scenes bar */}
                      <div className="flex shrink-0 items-center justify-between border-b border-sf-border px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className="text-sm font-semibold text-sf-primary">
                            {t('scenes_draftScenes')}
                          </span>
                          <AnimatePresence>
                            {scenes.length > 0 && (
                              <motion.span
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.8 }}
                                transition={{ duration: 0.15 }}
                                className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-sf-border px-1.5 font-mono text-xs font-medium text-sf-secondary"
                              >
                                {scenes.length}
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setFormState((s) => ({
                              open: true,
                              scene: null,
                              addKey: s.addKey + 1,
                            }))
                          }
                        >
                          <IconPlus size={11} />
                          {t('scenes_addScene')}
                        </Button>
                      </div>

                      {/* Scene list */}
                      <div className="flex-1 overflow-y-auto">
                        <DndContext
                          sensors={sensors}
                          collisionDetection={closestCenter}
                          onDragEnd={handleDragEnd}
                        >
                          <SortableContext
                            items={sorted.map((s) => s.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {sorted.map((scene, index) => (
                              <SortableSceneRow
                                key={scene.id}
                                scene={scene}
                                index={index}
                                onEdit={(s) =>
                                  setFormState((prev) => ({
                                    open: true,
                                    scene: s,
                                    addKey: prev.addKey,
                                  }))
                                }
                                onDelete={(id) => setConfirmDeleteId(id)}
                              />
                            ))}
                          </SortableContext>
                        </DndContext>
                      </div>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer — scenes view only */}
          {view === 'scenes' && !isEmpty && (
            <div className="flex shrink-0 items-center justify-between border-t border-sf-border px-5 py-3">
              {/* Left: drafts pill + keyboard hints */}
              <div className="flex items-center gap-3">
                {drafts.length > 0 && (
                  <button
                    onClick={() => setView('drafts')}
                    className="flex items-center gap-1.5 rounded-md border border-sf-border/60 bg-sf-panel/50 px-2.5 py-1.5 text-[11.5px] font-medium text-sf-muted transition-all duration-150 hover:border-sf-border hover:bg-sf-panel hover:text-sf-secondary"
                  >
                    <IconFilm size={11} />
                    {t('scenes_drafts')}
                    <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sf-border px-1 font-mono text-[10px] font-medium text-sf-secondary">
                      {drafts.length}
                    </span>
                  </button>
                )}
                <div className="flex items-center gap-1 opacity-60">
                  {[
                    [navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl', '⌥', '['],
                    [navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl', '⌥', ']'],
                  ].map((keys, gi) => (
                    <span key={gi} className="flex items-center gap-0.5">
                      {gi > 0 && <span className="px-0.5 text-[10px] text-sf-muted/40">/</span>}
                      {keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded border border-sf-border bg-sf-bg px-1 font-mono text-[10px] leading-none text-sf-secondary"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  ))}
                </div>
              </div>
              {/* Right: save + start */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-sf-border text-sf-secondary hover:text-sf-primary"
                  onClick={() => setSaveDraftOpen(true)}
                >
                  {t('scenes_saveDraft')}
                </Button>
                <Button size="sm" onClick={onStartRecording} disabled={scenes.length === 0}>
                  {t('scenes_startRecording')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Scene add/edit modal */}
      <SceneAddModal
        key={formState.scene?.id ?? `add-${formState.addKey}`}
        open={formState.open}
        mode={formState.scene ? 'edit' : 'add'}
        scene={formState.scene ?? undefined}
        sceneNumber={formSceneNumber}
        insertAfterTitle={formState.scene ? undefined : lastScene?.title}
        onClose={() => setFormState((s) => ({ open: false, scene: null, addKey: s.addKey }))}
        onSave={handleFormSave}
      />

      {/* Save draft dialog */}
      <SaveDraftDialog
        open={saveDraftOpen}
        onSave={handleSaveDraft}
        onCancel={() => setSaveDraftOpen(false)}
      />

      {/* Confirm scene delete */}
      <ConfirmModal
        open={confirmDeleteId !== null}
        title={t('scenes_deleteScene')}
        description={t('scenes_deleteSceneDesc')}
        confirmText={t('delete')}
        variant="destructive"
        onConfirm={() => {
          if (confirmDeleteId) {
            deleteScene(confirmDeleteId);
          }
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {/* Confirm loading a draft over current scenes */}
      <ConfirmModal
        open={confirmLoadDraft !== null}
        title={t('scenes_replaceTitle')}
        description={t('scenes_replaceDesc', {
          title: confirmLoadDraft?.title ?? '',
          count: scenes.length,
        })}
        confirmText={t('scenes_loadDraft')}
        variant="destructive"
        onConfirm={handleConfirmLoad}
        onCancel={() => setConfirmLoadDraft(null)}
      />

      <ConfirmModal
        open={showUnsavedWarning}
        title={t('scenes_unsavedRecording')}
        description={t('scenes_unsavedDesc')}
        confirmText={t('scenes_discard')}
        variant="destructive"
        onConfirm={discardAndOpenNewRecording}
        onCancel={() => setShowUnsavedWarning(false)}
      />
    </>
  );
};
