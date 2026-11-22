import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from 'src/store';
import { trackEvent } from 'src/lib/analytics';
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Slider,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from 'src/lib/ui';
import {
  IconAiMagic,
  IconAlignBottom,
  IconAlignMiddle,
  IconAlignTop,
  IconCaptions,
  IconCheck,
  IconChip,
  IconInfo,
  IconMicrophoneOff,
  IconPencil,
  IconPlayerPauseFilled,
  IconScissors,
  IconTextBold,
  IconTextItalic,
  IconX,
} from 'src/lib/icons';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { cn, formatTime } from 'src/lib/utils';
import { WidgetEnabledGate } from '../WidgetEnabledGate';
import type { CaptionPosition, CaptionSegment, CaptionWord, WhisperModel } from 'src/types/index';
import {
  mapTimelineTimeToSource,
  resolveTimelineCuts,
  sumTimeRanges,
  type TimeRange,
} from 'src/lib/helpers/segments';
import {
  DEFAULT_MIN_SILENCE,
  DEFAULT_SILENCE_PAD,
  flattenTranscript,
  getActivityTimes,
  getWordCutRanges,
  getWordKey,
  getWordRangeKeys,
  getWordTimelineSpan,
  isWordOnTimeline,
  planCleanup,
} from 'src/lib/captions/transcriptEdit';
import { cutTimelineRanges } from './cutTimelineRanges';
import { TranscriptCleanupCard, type CleanupSettings } from './TranscriptCleanupCard';
import { TranscriptSelectionBar } from './TranscriptSelectionBar';

const WHISPER_MODELS: { value: WhisperModel; label: string; sizeMb: number; quality: string }[] = [
  { value: 'tiny', label: 'Tiny', sizeMb: 39, quality: 'Fastest' },
  { value: 'base', label: 'Base', sizeMb: 74, quality: 'Fast' },
  { value: 'small', label: 'Small', sizeMb: 244, quality: 'Accurate' },
  { value: 'medium', label: 'Medium', sizeMb: 769, quality: 'Precise' },
];

const CURATED_FONTS = [
  'system-ui',
  'Helvetica Neue',
  'Instrument Sans',
  'Inter',
  'Geist',
  'Georgia',
  'Playfair Display',
  'JetBrains Mono',
  'Impact',
  'Arial Black',
  'Trebuchet MS',
  'Courier New',
] as const;

const DEFAULT_CAPTION_APPEARANCE = {
  fontFamily: 'system-ui',
  fontScale: 1.0,
  bold: true,
  italic: false,
  textColor: '#ffffff',
  highlightColor: '#ffffff',
  textOpacity: 100,
  backgroundEnabled: true,
  backgroundColor: '#0a0a0c',
  backgroundOpacity: 60,
  backgroundRadius: 30,
  position: 'bottom',
} as const;

type TranscribeStage = 'model-load' | 'transcribing';

/** Modifier keys of a word click or key press, for selecting words. */
type WordClickModifiers = Pick<ReactMouseEvent, 'shiftKey' | 'metaKey' | 'ctrlKey'>;

const EMPTY_KEYS: ReadonlySet<string> = new Set();
const EMPTY_PAUSES: ReadonlyMap<string, number> = new Map();

const DEFAULT_CLEANUP_SETTINGS: CleanupSettings = {
  fillers: true,
  silences: true,
  minSilence: DEFAULT_MIN_SILENCE,
};

const LiveBadge = () => {
  const { t } = useTranslation('captions');
  return (
    <span className="rounded-full border border-sf-border-lt/70 bg-sf-border-lt/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-primary">
      {t('live')}
    </span>
  );
};

const ColorSwatch = ({ color, onChange }: { color: string; onChange: (v: string) => void }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="size-7 shrink-0 rounded border border-sf-border transition-[border-color] hover:border-sf-border-lt"
        style={{ backgroundColor: color }}
        onClick={() => ref.current?.click()}
        aria-label="Pick color"
      />
      <input
        ref={ref}
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      />
    </>
  );
};

const CaptionSegmentCard = ({
  segment,
  index,
  isActive,
  sourceTime,
  timelineSpan,
  cutKeys,
  selectedKeys,
  fillerKeys,
  pausesBefore,
  onDelete,
  onCutLine,
  onWordClick,
  onEditConfirm,
}: {
  segment: CaptionSegment;
  index: number;
  isActive: boolean;
  /** Playhead position in source time, or null when the playhead is on no clip. */
  sourceTime: number | null;
  /** Where the line's remaining words play on the timeline; null once all are cut. */
  timelineSpan: TimeRange | null;
  /** Words already cut from the video. */
  cutKeys: ReadonlySet<string>;
  selectedKeys: ReadonlySet<string>;
  /** Clean-up preview: filler words that would be cut. */
  fillerKeys: ReadonlySet<string>;
  /** Clean-up preview: pause length that would be cut before a word. */
  pausesBefore: ReadonlyMap<string, number>;
  onDelete: () => void;
  onCutLine: () => void;
  onWordClick: (index: number, modifiers: WordClickModifiers) => void;
  onEditConfirm: (id: string, newText: string) => void;
}) => {
  const { t } = useTranslation('captions');
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(segment.text);
  const [prevText, setPrevText] = useState(segment.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync editText when the segment text changes externally (undo/redo) — update during render,
  // not in an effect, so React can batch without an extra commit.
  if (segment.text !== prevText) {
    setPrevText(segment.text);
    if (!isEditing) {
      setEditText(segment.text);
    }
  }

  // Focus and move cursor to end when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [isEditing]);

  // Auto-resize textarea as content changes
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [editText, isEditing]);

  const confirmEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== segment.text) {
      onEditConfirm(segment.id, trimmed);
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setEditText(segment.text);
    setIsEditing(false);
  };

  const activeWordIndex =
    isEditing || sourceTime === null
      ? -1
      : segment.words.findIndex((w) => sourceTime >= w.start && sourceTime < w.end);
  const isLineCut = timelineSpan === null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'group overflow-hidden rounded-md border transition-[border-color,box-shadow,background-color] duration-150',
            isEditing
              ? 'border-primary/25 bg-[#151519]'
              : isActive
                ? 'border-sf-border-lt bg-[#151519] shadow-[0_0_0_1px_var(--color-sf-border-lt),0_10px_24px_rgba(0,0,0,0.18)]'
                : 'border-sf-border hover:border-sf-border-lt',
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-1.5 px-2.5 py-2">
            <div className="flex flex-1 items-center gap-2 min-w-full">
              <span
                className={cn(
                  'text-sm font-medium',
                  isActive || isEditing ? 'text-sf-primary' : 'text-sf-secondary',
                )}
              >
                {t('line', { index: index + 1 })}
              </span>
              {isActive && !isEditing && <LiveBadge />}
              <span
                className={cn(
                  'ml-auto font-mono text-xs text-sf-muted',
                  isLineCut && 'line-through opacity-50',
                )}
              >
                {formatTime(timelineSpan?.start ?? segment.start)} →{' '}
                {formatTime(timelineSpan?.end ?? segment.end)}
              </span>
            </div>

            {isEditing ? (
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('ariaConfirmEdit')}
                  className="text-primary hover:bg-primary/10 hover:text-primary"
                  onClick={confirmEdit}
                >
                  <IconCheck size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('ariaCancelEdit')}
                  onClick={cancelEdit}
                >
                  <IconX size={13} />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('ariaEditCaption')}
                  className="opacity-40 transition-opacity group-hover:opacity-100"
                  onClick={() => setIsEditing(true)}
                >
                  <IconPencil size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('ariaDeleteCaption')}
                  className={cn(
                    'transition-opacity group-hover:opacity-100',
                    isActive ? 'opacity-40' : 'opacity-0',
                  )}
                  onClick={onDelete}
                >
                  <IconX size={13} />
                </Button>
              </div>
            )}
          </div>

          {/* Body — edit mode or read mode */}
          {isEditing ? (
            <div className="px-3 pb-3">
              <textarea
                ref={textareaRef}
                value={editText}
                rows={1}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={confirmEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    confirmEdit();
                  } else if (e.key === 'Escape') {
                    cancelEdit();
                  }
                }}
                className="w-full resize-none bg-transparent text-sm leading-relaxed text-sf-primary outline-none"
              />
              <motion.p
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="mt-1 text-[10px] text-sf-muted"
              >
                {t('editHint')}
              </motion.p>
            </div>
          ) : (
            <div
              className="relative cursor-text px-3 pb-3 text-sm leading-relaxed text-sf-secondary"
              onDoubleClick={() => setIsEditing(true)}
            >
              {segment.words.map((word: CaptionWord, i: number) => {
                const key = getWordKey(segment.id, i);
                const isCut = cutKeys.has(key);
                const isSelected = selectedKeys.has(key);
                const isFiller = fillerKeys.has(key);
                const pause = pausesBefore.get(key);
                return (
                  <Fragment key={i}>
                    {pause !== undefined && (
                      <span
                        aria-label={t('pauseChip', { duration: formatTime(pause) })}
                        className="mr-1 inline-flex items-center gap-0.5 rounded bg-primary/15 px-1 align-middle font-mono text-[10px] leading-4 text-primary"
                      >
                        <IconPlayerPauseFilled size={9} />
                        {formatTime(pause)}
                      </span>
                    )}
                    <span
                      role="button"
                      tabIndex={isCut ? -1 : 0}
                      aria-pressed={isSelected}
                      title={isCut ? t('wordWasCut') : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        onWordClick(i, e);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onWordClick(i, e);
                        }
                      }}
                      className={cn(
                        'rounded transition-colors duration-100',
                        isCut
                          ? 'cursor-default text-sf-muted/50 line-through'
                          : 'cursor-pointer hover:text-sf-primary',
                        i === activeWordIndex && !isCut ? 'font-medium text-primary' : '',
                        isSelected && 'bg-primary/25 text-sf-primary',
                        isFiller && 'bg-primary/15 text-primary line-through decoration-primary/70',
                      )}
                    >
                      {word.word}
                    </span>{' '}
                  </Fragment>
                );
              })}
              <span className="pointer-events-auto absolute bottom-2 right-2 opacity-0 transition-opacity duration-150 group-hover:opacity-50">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="cursor-default"
                      aria-label={t('ariaHowToEdit')}
                    >
                      <IconInfo size={13} className="text-sf-muted" stroke={1.5} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <div className="flex flex-col gap-0.5">
                      <span>{t('doubleClickToEdit')}</span>
                      <span>{t('rightClickToDelete')}</span>
                      <span>
                        {segment.edited ? t('editedLineNoWordCut') : t('shiftClickToSelect')}
                      </span>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </span>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={isLineCut} onClick={onCutLine}>
          <IconScissors size={14} />
          {t('cutLine')}
        </ContextMenuItem>
        <ContextMenuItem
          className="text-red-300 focus:bg-red-500/15 focus:text-red-100"
          onClick={onDelete}
        >
          {t('deleteSegment')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export const CaptionWidget = () => {
  const { t } = useTranslation('captions');
  const {
    recordingResult,
    captions,
    setCaptions,
    commitEdit,
    currentTime,
    requestSeekTo,
    currentProjectId,
    mediaSegments,
  } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      captions: state.captions,
      setCaptions: state.setCaptions,
      commitEdit: state.commitEdit,
      currentTime: state.currentTime,
      requestSeekTo: state.requestSeekTo,
      currentProjectId: state.currentProjectId,
      mediaSegments: state.mediaSegments,
    })),
  );

  // Always read segments from the live store so that appearance-only updates
  // (font, color, etc.) never overwrite caption edits committed via commitEdit
  // before React has had a chance to re-render this component.
  const liveCaption = () => useStore.getState().captions;

  const [selectedModel, setSelectedModel] = useState<WhisperModel>(captions.model);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStage, setTranscribeStage] = useState<TranscribeStage | null>(null);
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [isModelCached, setIsModelCached] = useState(true);
  const [canShowDownload, setCanShowDownload] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const segmentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const isTranscribingRef = useRef(false);

  const hasAudio = !!recordingResult?.audioPath;

  // ── Edit by transcript ──────────────────────────────────────────────────
  // Caption words are in source time; the playhead and cuts are in timeline time.
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupSettings, setCleanupSettings] = useState(DEFAULT_CLEANUP_SETTINGS);
  const [prevSegments, setPrevSegments] = useState(captions.segments);

  // A new transcript (or undo/redo of a caption edit) invalidates word selections.
  if (captions.segments !== prevSegments) {
    setPrevSegments(captions.segments);
    setSelectedKeys(EMPTY_KEYS);
    setAnchorKey(null);
  }

  const sourceTime = mapTimelineTimeToSource(mediaSegments, currentTime);
  const words = useMemo(() => flattenTranscript(captions.segments), [captions.segments]);
  const cutKeys = useMemo(
    () => new Set(words.filter((w) => !isWordOnTimeline(mediaSegments, w)).map((w) => w.key)),
    [words, mediaSegments],
  );
  const lineSpans = useMemo(() => {
    const spans = new Map<string, TimeRange | null>();
    for (const seg of captions.segments) {
      const kept = seg.words
        .map((w) => getWordTimelineSpan(mediaSegments, w))
        .filter((span): span is TimeRange => span !== null);
      spans.set(
        seg.id,
        kept.length > 0 ? { start: kept[0].start, end: kept[kept.length - 1].end } : null,
      );
    }
    return spans;
  }, [captions.segments, mediaSegments]);

  const activityTimes = useMemo(() => getActivityTimes(recordingResult), [recordingResult]);
  const cleanupPlan = useMemo(
    () =>
      cleanupOpen
        ? planCleanup(captions.segments, mediaSegments, {
            language: captions.language,
            fillers: cleanupSettings.fillers,
            silences: cleanupSettings.silences,
            minSilence: cleanupSettings.minSilence,
            silencePad: DEFAULT_SILENCE_PAD,
            activityTimes,
          })
        : null,
    [
      cleanupOpen,
      captions.segments,
      captions.language,
      mediaSegments,
      cleanupSettings,
      activityTimes,
    ],
  );
  const previewFillerKeys = useMemo(
    () =>
      cleanupPlan
        ? new Set(cleanupPlan.cuts.filter((c) => c.kind === 'filler').map((c) => c.wordKey))
        : EMPTY_KEYS,
    [cleanupPlan],
  );
  const previewPauses = useMemo(
    () =>
      cleanupPlan
        ? new Map(
            cleanupPlan.cuts
              .filter((c) => c.kind === 'silence')
              .map((c) => [c.wordKey, c.duration] as const),
          )
        : EMPTY_PAUSES,
    [cleanupPlan],
  );

  const selectionRanges = useMemo(
    () => getWordCutRanges(words, mediaSegments, selectedKeys),
    [words, mediaSegments, selectedKeys],
  );
  const selectionDuration = sumTimeRanges(resolveTimelineCuts(mediaSegments, selectionRanges));

  const clearSelection = () => {
    setSelectedKeys(EMPTY_KEYS);
  };

  const handleWordClick = (seg: CaptionSegment, index: number, modifiers: WordClickModifiers) => {
    const key = getWordKey(seg.id, index);
    if (cutKeys.has(key)) {
      return;
    }
    const selectable = (k: string) => {
      const word = words.find((w) => w.key === k);
      return !!word && !word.edited && !cutKeys.has(k);
    };

    if (modifiers.shiftKey || modifiers.metaKey || modifiers.ctrlKey) {
      if (!selectable(key)) {
        return;
      }
      if (modifiers.shiftKey && anchorKey) {
        setSelectedKeys(new Set(getWordRangeKeys(words, anchorKey, key).filter(selectable)));
      } else {
        const next = new Set(selectedKeys);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        setSelectedKeys(next);
        setAnchorKey(key);
      }
      return;
    }

    setSelectedKeys(EMPTY_KEYS);
    setAnchorKey(key);
    const span = getWordTimelineSpan(mediaSegments, seg.words[index]);
    if (span) {
      requestSeekTo(span.start);
    }
  };

  const handleCutSelection = () => {
    if (selectedKeys.size === 0) {
      return;
    }
    const removed = cutTimelineRanges('Cut words', selectionRanges);
    if (removed) {
      trackEvent('transcript_words_cut', {
        word_count: selectedKeys.size,
        seconds: Math.round(sumTimeRanges(removed) * 10) / 10,
      });
    }
    clearSelection();
  };

  const handleCutLine = (seg: CaptionSegment) => {
    const keys = new Set(seg.words.map((_, i) => getWordKey(seg.id, i)));
    const removed = cutTimelineRanges(
      'Cut caption line',
      getWordCutRanges(words, mediaSegments, keys),
    );
    if (removed) {
      trackEvent('transcript_line_cut', {
        seconds: Math.round(sumTimeRanges(removed) * 10) / 10,
      });
    }
    clearSelection();
  };

  const handleApplyCleanup = () => {
    if (!cleanupPlan || cleanupPlan.ranges.length === 0) {
      return;
    }
    const removed = cutTimelineRanges('Remove filler words and pauses', cleanupPlan.ranges);
    if (removed) {
      trackEvent('transcript_cleanup_applied', {
        filler_count: cleanupPlan.cuts.filter((c) => c.kind === 'filler').length,
        pause_count: cleanupPlan.cuts.filter((c) => c.kind === 'silence').length,
        min_pause_seconds: cleanupSettings.minSilence,
        seconds: Math.round(sumTimeRanges(removed) * 10) / 10,
      });
    }
    setCleanupOpen(false);
    clearSelection();
  };

  const handleTranscriptKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input')) {
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedKeys.size > 0) {
      // Keep the timeline's own Delete shortcut from also deleting its selected clip.
      e.preventDefault();
      e.stopPropagation();
      handleCutSelection();
    } else if (e.key === 'Escape' && selectedKeys.size > 0) {
      e.stopPropagation();
      clearSelection();
    }
  };

  const activeSegmentId =
    sourceTime === null
      ? null
      : (captions.segments.find((s) => sourceTime >= s.start && sourceTime <= s.end)?.id ?? null);

  useEffect(() => {
    if (!activeSegmentId) {
      return;
    }
    segmentRefs.current[activeSegmentId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeSegmentId]);

  useEffect(() => {
    isTranscribingRef.current = isTranscribing;
  }, [isTranscribing]);

  useEffect(() => {
    if (!isTranscribingRef.current) {
      return;
    }
    window.screenforge.cancelTranscription();
    setIsTranscribing(false);
    setTranscribeStage(null);
    setCanShowDownload(false);
  }, [currentProjectId]);

  useEffect(() => {
    const unsub = window.screenforge.onTranscribeProgress(({ stage, progress }) => {
      setTranscribeStage(stage);
      setTranscribeProgress(progress);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!isTranscribing) {
      setCanShowDownload(false);
      return;
    }
    const timer = window.setTimeout(() => setCanShowDownload(true), 1800);
    return () => window.clearTimeout(timer);
  }, [isTranscribing]);

  const handleTranscribe = async () => {
    if (!recordingResult || !hasAudio) {
      return;
    }

    const { cached } = await window.screenforge.getWhisperModelStatus(selectedModel);
    setIsModelCached(cached);
    setIsTranscribing(true);
    setTranscribeProgress(0);
    setTranscribeStage('model-load');

    try {
      const segments = await window.screenforge.transcribeAudio(
        recordingResult.filePath,
        selectedModel,
        'en',
      );
      setCaptions({ ...captions, segments, model: selectedModel });
      trackEvent('captions_transcribed', {
        model: selectedModel,
        segment_count: segments.length,
        duration_seconds: Math.round(recordingResult.duration),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('cancelled')) {
        console.error('[captions] transcription failed:', msg);
        const userMsg =
          msg.includes('exited with code') || msg.includes('crashed')
            ? t('transcriptionCrashed')
            : msg;
        toast.error(userMsg);
      }
    } finally {
      setIsTranscribing(false);
      setTranscribeStage(null);
    }
  };

  const handleCancel = () => {
    window.screenforge.cancelTranscription();
    setIsTranscribing(false);
    setTranscribeStage(null);
  };

  const handleDeleteSegment = (id: string) => {
    trackEvent('caption_deleted');
    commitEdit('Delete caption', (state) => ({
      captions: {
        ...state.captions,
        segments: state.captions.segments
          .filter((s) => s.id !== id)
          .map((seg) => ({ ...seg, words: seg.words.map((w) => ({ ...w })) })),
      },
    }));
  };

  const handleEditSegment = (id: string, newText: string) => {
    trackEvent('caption_edited');
    commitEdit('Edit caption', (state) => ({
      captions: {
        ...state.captions,
        segments: state.captions.segments.map((s) => {
          if (s.id !== id) {
            return { ...s, words: s.words.map((w) => ({ ...w })) };
          }
          const wordStrings = newText.split(/\s+/).filter(Boolean);
          const duration = s.end - s.start;
          const totalChars = wordStrings.reduce((sum, w) => sum + w.length, 0) || 1;
          let cursor = s.start;
          const words: CaptionWord[] = wordStrings.map((word) => {
            const share = (word.length / totalChars) * duration;
            const start = cursor;
            const end = cursor + share;
            cursor = end;
            return { word, start, end };
          });
          return { ...s, text: newText, words, edited: true };
        }),
      },
    }));
  };

  const modelInfo = WHISPER_MODELS.find((m) => m.value === selectedModel) ?? WHISPER_MODELS[2];

  const transcribeLabel = (() => {
    if (transcribeStage === 'transcribing') {
      return t('transcribing');
    }
    if (!isModelCached && canShowDownload && transcribeProgress > 0 && transcribeProgress < 1) {
      return t('downloading', { percent: Math.round(transcribeProgress * 100) });
    }
    return t('preparing');
  })();

  if (!recordingResult) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={WIDGET_PANEL_HEADER_CLASS}>
          <IconCaptions className="size-4.5" />
          {t('header')}
        </div>
        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconCaptions size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WidgetEnabledGate
        title={t('header')}
        icon={<IconCaptions className="size-4.5" />}
        enabled={captions.captionsEnabled}
        onToggle={(checked) => {
          setCaptions({ ...liveCaption(), captionsEnabled: checked });
          trackEvent('captions_enabled_toggled', { enabled: checked });
        }}
      >
        <div className="flex shrink-0 flex-col gap-3 px-3">
          {/* Engine block */}
          <div className="flex flex-col gap-3 rounded-md border border-sf-border bg-sf-panel p-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-sf-muted">
              <IconChip size={20} />
              {t('onDeviceEngine')}
            </span>

            <Select
              value={selectedModel}
              onValueChange={(v) => setSelectedModel(v as WhisperModel)}
              disabled={isTranscribing}
            >
              <SelectTrigger className="h-9 border-sf-border bg-transparent">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-sm font-medium text-sf-primary">{modelInfo.label}</span>
                  <span className="text-[11px] text-sf-muted">{modelInfo.quality}</span>
                  <span className="ml-auto font-mono text-[11px] text-sf-muted">
                    {modelInfo.sizeMb} MB
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {WHISPER_MODELS.map((m) => (
                  <SelectItem
                    key={m.value}
                    value={m.value}
                    className="pl-3 [&>span:first-child]:hidden [&>span:last-child]:flex-1"
                  >
                    <div className="flex w-full items-center">
                      <span className="text-sm">{m.label}</span>
                      <span className="ml-2 text-[11px] text-sf-muted">{m.quality}</span>
                      <span className="ml-auto font-mono text-[11px] text-sf-muted">
                        {m.sizeMb} MB
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <p className="-mt-2 text-xs text-sf-muted">{t('whisperDesc')}</p>
          </div>

          {/* Transcribe / no-audio / progress */}
          {!hasAudio ? (
            <div className="flex items-start gap-2.5 rounded-md border border-sf-border bg-sf-panel p-3">
              <IconMicrophoneOff size={16} className="mt-0.5 shrink-0 text-sf-muted" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-sf-secondary">{t('noAudioTrack')}</span>
                <span className="text-xs text-sf-muted">{t('noAudioTrackDesc')}</span>
              </div>
            </div>
          ) : !isTranscribing ? (
            <Button size="md" className="w-full gap-2" onClick={handleTranscribe}>
              <IconAiMagic size={16} />
              {t('transcribe')}
            </Button>
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <Button size="md" className="w-full gap-2" disabled>
                <Spinner className="relative -top-[1px] size-3.5 fill-white text-white/30" />
                {transcribeLabel}
              </Button>
              <button
                type="button"
                onClick={handleCancel}
                className="text-xs text-sf-muted/40 transition-colors hover:text-sf-muted"
              >
                {t('cancel')}
              </button>
            </div>
          )}

          {captions.segments.length > 0 && (
            <p className="mt-2 text-xs text-sf-muted">
              {t('whisperModel', { model: modelInfo.label })}
              {' · '}
              {t('lineCount', { count: captions.segments.length })}
            </p>
          )}
        </div>

        {/* Scrollable area: clean-up, appearance card + segment list */}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          {captions.segments.length > 0 && (
            <TranscriptCleanupCard
              open={cleanupOpen}
              plan={cleanupPlan}
              settings={cleanupSettings}
              onOpen={() => {
                setCleanupOpen(true);
                clearSelection();
              }}
              onClose={() => setCleanupOpen(false)}
              onSettingsChange={setCleanupSettings}
              onApply={handleApplyCleanup}
            />
          )}

          {/* Appearance card — only when transcription exists */}
          {captions.segments.length > 0 && (
            <div
              className={cn(
                'mb-3 overflow-hidden rounded-md border bg-sf-panel transition-[border-color,box-shadow,background-color]',
                appearanceOpen
                  ? 'border-sf-border-lt bg-[#151519] shadow-[0_0_0_1px_var(--color-sf-border-lt),0_10px_24px_rgba(0,0,0,0.18)]'
                  : 'border-sf-border hover:border-sf-border-lt',
              )}
            >
              <button
                type="button"
                onClick={() => setAppearanceOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
              >
                <span className="flex-1 text-sm font-medium text-sf-secondary">
                  {t('appearance')}
                </span>
                <motion.span
                  animate={{ rotate: appearanceOpen ? 180 : 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="text-sf-muted"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2 4L6 8L10 4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {appearanceOpen && (
                  <motion.div
                    key="appearance-panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="flex flex-col gap-4 border-t border-sf-border px-3 py-3">
                      {/* Font */}
                      <div className="flex flex-col gap-2">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('font')}</div>
                        <Select
                          value={captions.fontFamily}
                          onValueChange={(v) => setCaptions({ ...liveCaption(), fontFamily: v })}
                        >
                          <SelectTrigger className="w-full">
                            <span className="text-sm text-sf-primary">{captions.fontFamily}</span>
                          </SelectTrigger>
                          <SelectContent>
                            {CURATED_FONTS.map((f) => (
                              <SelectItem key={f} value={f}>
                                {f}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Slider
                          min={0.5}
                          max={2.0}
                          step={0.05}
                          inlineLabel={t('size')}
                          valueLabel={`${Math.round(captions.fontScale * 100)}%`}
                          value={[captions.fontScale]}
                          onValueChange={([v]) => setCaptions({ ...liveCaption(), fontScale: v })}
                        />
                      </div>

                      {/* Format */}
                      <div className="flex flex-col gap-2">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('format')}</div>
                        <ToggleGroup
                          type="multiple"
                          size="sm"
                          value={[
                            captions.bold ? 'bold' : '',
                            captions.italic ? 'italic' : '',
                          ].filter(Boolean)}
                          onValueChange={(vals) =>
                            setCaptions({
                              ...liveCaption(),
                              bold: vals.includes('bold'),
                              italic: vals.includes('italic'),
                            })
                          }
                        >
                          <ToggleGroupItem value="bold" aria-label="Bold" className="size-7">
                            <IconTextBold size={14} />
                          </ToggleGroupItem>
                          <ToggleGroupItem value="italic" aria-label="Italic" className="size-7">
                            <IconTextItalic size={14} />
                          </ToggleGroupItem>
                        </ToggleGroup>
                      </div>

                      {/* Text color */}
                      <div className="flex flex-col gap-2">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('color')}</div>
                        <div className="flex items-center gap-2">
                          <ColorSwatch
                            color={captions.textColor}
                            onChange={(v) => setCaptions({ ...liveCaption(), textColor: v })}
                          />
                          <input
                            type="text"
                            value={captions.textColor.toUpperCase()}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) {
                                setCaptions({ ...liveCaption(), textColor: v });
                              }
                            }}
                            className="h-8 flex-1 rounded-md border border-sf-border bg-sf-bg px-2.5 font-mono text-xs text-sf-primary outline-none transition-[border-color] focus:border-sf-border-lt"
                          />
                        </div>
                        <Slider
                          min={0}
                          max={100}
                          step={1}
                          inlineLabel={t('opacity')}
                          valueLabel={`${captions.textOpacity}%`}
                          value={[captions.textOpacity]}
                          onValueChange={([v]) => setCaptions({ ...liveCaption(), textOpacity: v })}
                        />
                      </div>

                      {/* Highlight color */}
                      <div className="flex flex-col gap-2">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('highlight')}</div>
                        <div className="flex items-center gap-2">
                          <ColorSwatch
                            color={captions.highlightColor}
                            onChange={(v) => setCaptions({ ...liveCaption(), highlightColor: v })}
                          />
                          <input
                            type="text"
                            value={captions.highlightColor.toUpperCase()}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) {
                                setCaptions({ ...liveCaption(), highlightColor: v });
                              }
                            }}
                            className="h-8 flex-1 rounded-md border border-sf-border bg-sf-bg px-2.5 font-mono text-xs text-sf-primary outline-none transition-[border-color] focus:border-sf-border-lt"
                          />
                        </div>
                      </div>

                      {/* Background */}
                      <div className="flex flex-col gap-2">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('background')}</div>
                        <div className="flex items-center gap-2">
                          <ColorSwatch
                            color={captions.backgroundColor}
                            onChange={(v) => setCaptions({ ...liveCaption(), backgroundColor: v })}
                          />
                          <input
                            type="text"
                            value={captions.backgroundColor.toUpperCase()}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) {
                                setCaptions({ ...liveCaption(), backgroundColor: v });
                              }
                            }}
                            className="h-8 flex-1 rounded-md border border-sf-border bg-sf-bg px-2.5 font-mono text-xs text-sf-primary outline-none transition-[border-color] focus:border-sf-border-lt"
                          />
                        </div>
                        <Slider
                          min={0}
                          max={100}
                          step={1}
                          inlineLabel={t('opacity')}
                          valueLabel={`${captions.backgroundOpacity}%`}
                          value={[captions.backgroundOpacity]}
                          onValueChange={([v]) =>
                            setCaptions({ ...liveCaption(), backgroundOpacity: v })
                          }
                        />
                        <Slider
                          min={0}
                          max={100}
                          step={1}
                          inlineLabel={t('radius')}
                          valueLabel={`${captions.backgroundRadius}px`}
                          value={[captions.backgroundRadius]}
                          onValueChange={([v]) =>
                            setCaptions({ ...liveCaption(), backgroundRadius: v })
                          }
                        />
                      </div>

                      {/* Position */}
                      <div className="flex flex-col gap-2">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('position')}</div>
                        <ToggleGroup
                          type="single"
                          size="sm"
                          value={captions.position}
                          onValueChange={(v) => {
                            if (v) {
                              setCaptions({ ...liveCaption(), position: v as CaptionPosition });
                            }
                          }}
                        >
                          <ToggleGroupItem
                            value="top"
                            aria-label={t('positionTop')}
                            className="size-7"
                          >
                            <IconAlignTop size={14} />
                          </ToggleGroupItem>
                          <ToggleGroupItem
                            value="center"
                            aria-label={t('positionCenter')}
                            className="size-7"
                          >
                            <IconAlignMiddle size={14} />
                          </ToggleGroupItem>
                          <ToggleGroupItem
                            value="bottom"
                            aria-label={t('positionBottom')}
                            className="size-7"
                          >
                            <IconAlignBottom size={14} />
                          </ToggleGroupItem>
                        </ToggleGroup>
                      </div>

                      <div className="flex justify-end border-t border-sf-border pt-2">
                        {(() => {
                          const isDefault = (
                            Object.keys(DEFAULT_CAPTION_APPEARANCE) as Array<
                              keyof typeof DEFAULT_CAPTION_APPEARANCE
                            >
                          ).every((k) => captions[k] === DEFAULT_CAPTION_APPEARANCE[k]);
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  disabled={isDefault}
                                  onClick={() =>
                                    setCaptions({ ...liveCaption(), ...DEFAULT_CAPTION_APPEARANCE })
                                  }
                                  className="cursor-pointer text-xs text-sf-muted transition-colors hover:text-sf-primary disabled:cursor-default disabled:text-sf-muted/30 disabled:hover:text-sf-muted/30"
                                >
                                  {t('reset')}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                {isDefault ? t('resetAlreadyDefault') : t('resetToDefaults')}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Segment list */}
          {selectedKeys.size > 0 && (
            <TranscriptSelectionBar
              count={selectedKeys.size}
              duration={selectionDuration}
              onCut={handleCutSelection}
              onClear={clearSelection}
            />
          )}
          <div className="space-y-1.5" onKeyDown={handleTranscriptKeyDown}>
            <AnimatePresence initial={false}>
              {captions.segments.map((seg, index) => (
                <motion.div
                  key={seg.id}
                  ref={(node) => {
                    segmentRefs.current[seg.id] = node;
                  }}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <CaptionSegmentCard
                    segment={seg}
                    index={index}
                    isActive={activeSegmentId === seg.id}
                    sourceTime={sourceTime}
                    timelineSpan={lineSpans.get(seg.id) ?? null}
                    cutKeys={cutKeys}
                    selectedKeys={selectedKeys}
                    fillerKeys={previewFillerKeys}
                    pausesBefore={previewPauses}
                    onDelete={() => handleDeleteSegment(seg.id)}
                    onCutLine={() => handleCutLine(seg)}
                    onWordClick={(index, modifiers) => handleWordClick(seg, index, modifiers)}
                    onEditConfirm={handleEditSegment}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </WidgetEnabledGate>
    </div>
  );
};
