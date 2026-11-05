import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../../store';
import { IconChevronDown, IconMotion, IconPlus, IconRestart, IconSwap, IconX } from 'src/lib/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  PreviewCardBody,
  PreviewCardProvider,
  Slider,
  ToggleGroup,
  ToggleGroupItem,
  usePreviewCard,
} from '../../../../lib/ui';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import {
  addMotionAt,
  addPinnedMove,
  getClipPoses,
  getMotionGroup,
  getSegmentAt,
  layoutMotionClips,
  MOTION_AMOUNTS,
  MOTION_FEELS,
  MOTION_MOVES,
  MOTION_TONES,
  movesInGroup,
  resetClipCustom,
  setClipMove,
  setClipPoseValue,
  swapClipPoses,
} from 'src/lib/animation/motionClips';
import type {
  MotionAmount,
  MotionClip,
  MotionFeel,
  MotionMoveId,
  MotionPoses,
} from 'src/lib/animation/motionClips';
import { SCENE_MOTION_PROPS, SCENE_MOTION_SPECS } from 'src/lib/animation/sceneMotion';
import type { SceneMotionProp } from 'src/lib/animation/sceneMotion';
import { cn, formatTime } from 'src/lib/utils';
import { mapTimelineTimeToSource } from 'src/lib/helpers/segments';
import { MotionPreviewStage } from './MotionPreviewStage';
import type { MotionPreviewMode } from './MotionPreviewStage';
import { useRecordingFrame } from './useRecordingFrame';

const percent = (v: number) => `${Math.round(v * 100)}%`;
const degrees = (v: number) => `${Math.round(v * 10) / 10}°`;

const FORMAT: Record<SceneMotionProp, (v: number) => string> = {
  scale: percent,
  x: percent,
  y: percent,
  rotation: degrees,
  tiltX: degrees,
  tiltY: degrees,
  opacity: percent,
};

const BADGE_CLASS =
  'rounded-full border border-sf-border-lt/70 bg-sf-border-lt/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-primary';

export const MotionWidget = () => (
  <PreviewCardProvider>
    <MotionWidgetBody />
  </PreviewCardProvider>
);

const MotionWidgetBody = () => {
  const { t } = useTranslation('motion');
  const preview = usePreviewCard();
  const [manualExpandedId, setManualExpandedId] = useState<string | null>(null);
  const [advancedExpandedIds, setAdvancedExpandedIds] = useState<Record<string, boolean>>({});
  const [poseSide, setPoseSide] = useState<keyof MotionPoses>('from');
  const [noRoom, setNoRoom] = useState(false);
  const clipRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const {
    recordingResult,
    motionClips,
    frameSettings,
    mediaSegments,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
    setSelectedClip,
    currentTime,
    selectedClip,
    requestSeekTo,
    requestPauseAndSeekTo,
  } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      motionClips: state.motionClips,
      frameSettings: state.frame,
      mediaSegments: state.mediaSegments,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
      setSelectedClip: state.setSelectedClip,
      currentTime: state.currentTime,
      selectedClip: state.selectedClip,
      requestSeekTo: state.requestSeekTo,
      requestPauseAndSeekTo: state.requestPauseAndSeekTo,
    })),
  );

  const duration =
    mediaSegments.length > 0
      ? Math.max(...mediaSegments.map((s) => s.timelineEnd))
      : (recordingResult?.duration ?? 0);
  const clips = layoutMotionClips(motionClips, mediaSegments);
  // Intro / Outro in the Add menu belong to the clip under the playhead.
  const sortedSegments = [...mediaSegments].sort((a, b) => a.timelineStart - b.timelineStart);
  const playheadSegment =
    getSegmentAt(mediaSegments, currentTime) ??
    (currentTime <= (sortedSegments[0]?.timelineStart ?? 0)
      ? sortedSegments[0]
      : sortedSegments.at(-1));
  // One still of the user's own recording, decoded once, shared by every preview.
  const previewSourceTime =
    Math.round((mapTimelineTimeToSource(mediaSegments, duration / 2) ?? 0) * 2) / 2;
  const still = useRecordingFrame(recordingResult?.filePath ?? null, previewSourceTime);
  const sliderAnchor = useRef<HTMLElement | null>(null);

  /** Hover card for an option: the clip with that option applied, looping or held. */
  const bindPreview = (
    id: string,
    variant: MotionClip,
    title: string,
    description: string,
    isCurrent: boolean,
    mode: MotionPreviewMode = 'loop',
  ) =>
    preview.bind(id, () => (
      <PreviewCardBody
        preview={
          <MotionPreviewStage
            clip={variant}
            frame={still}
            background={frameSettings.background}
            mode={mode}
            label={mode === 'loop' ? undefined : t(`pose_${mode}`)}
          />
        }
        title={title}
        description={description}
        badge={isCurrent ? t('current') : undefined}
      />
    ));

  /**
   * Card for an Advanced slider (on hover and while dragging): holds the pose it
   * edits and reads the clip from the store when it renders, so it always shows
   * the latest value without this panel re-rendering it.
   */
  const renderLivePose = (clipId: string, side: keyof MotionPoses, prop: SceneMotionProp) => {
    const renderPose = () => {
      const live = useStore.getState().motionClips.find((c) => c.id === clipId);
      if (!live) {
        return null;
      }
      return (
        <PreviewCardBody
          preview={
            <MotionPreviewStage
              clip={live}
              frame={still}
              background={frameSettings.background}
              mode={side}
              label={t(`pose_${side}`)}
            />
          }
          title={t(`prop_${prop}`)}
          description={t('desc_editing')}
        />
      );
    };
    return renderPose;
  };

  const presentPose = (clipId: string, side: keyof MotionPoses, prop: SceneMotionProp) => {
    const anchor = sliderAnchor.current;
    if (anchor) {
      preview.present(`pose-${clipId}-${prop}`, anchor, renderLivePose(clipId, side, prop));
    }
  };
  const expandedId = selectedClip?.effectId === 'motion' ? selectedClip.id : manualExpandedId;
  const playheadClipId =
    clips.find((clip) => currentTime >= clip.start && currentTime <= clip.end)?.id ?? null;

  useEffect(() => {
    if (!playheadClipId) {
      return;
    }
    clipRefs.current[playheadClipId]?.scrollIntoView({ block: 'nearest' });
  }, [playheadClipId]);

  const expand = (clip: Pick<MotionClip, 'id' | 'start' | 'end'>) => {
    setSelectedClip({ id: clip.id, start: clip.start, end: clip.end, effectId: 'motion' });
    setManualExpandedId(clip.id);
  };

  const applyAdd = (label: string, result: { clips: MotionClip[]; id: string | null }) => {
    const added = result.clips.find((c) => c.id === result.id);
    setNoRoom(!added);
    if (!added) {
      return;
    }
    if (result.clips.length !== motionClips.length) {
      commitEdit(label, () => ({ motionClips: result.clips }));
    }
    expand(added);
    requestSeekTo(added.start);
  };

  const updateClip = (label: string, clipId: string, fn: (c: MotionClip) => MotionClip) =>
    commitEdit(label, (state) => ({
      motionClips: state.motionClips.map((c) => (c.id === clipId ? fn(c) : c)),
    }));

  const toggleAdvanced = (clipId: string) => {
    setAdvancedExpandedIds((current) => ({ ...current, [clipId]: !current[clipId] }));
  };

  if (!recordingResult) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={WIDGET_PANEL_HEADER_CLASS}>
          <IconMotion className="size-4.5" />
          {t('header')}
        </div>
        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconMotion size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-preview-boundary>
      <div className={WIDGET_PANEL_HEADER_CLASS}>
        <IconMotion className="size-4.5" />
        {t('header')}
      </div>

      {/* Add button */}
      <div className="shrink-0 px-3 flex flex-col gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="md" variant="secondary" className="w-full gap-1.5">
              <IconPlus size={14} />
              {t('addMotion')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="center" className="w-48 p-1">
            {playheadSegment && (
              <DropdownMenuItem
                className="cursor-pointer gap-2 py-1.5 px-2 text-sm"
                onClick={() =>
                  applyAdd(
                    t('addIntro'),
                    addPinnedMove(motionClips, mediaSegments, playheadSegment.id, 'start'),
                  )
                }
              >
                <IconMotion size={12} />
                <span>{t('addIntro')}</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className="cursor-pointer gap-2 py-1.5 px-2 text-sm"
              onClick={() =>
                applyAdd(t('addAtPlayhead'), addMotionAt(motionClips, mediaSegments, currentTime))
              }
            >
              <IconMotion size={12} />
              <span>{t('addAtPlayhead')}</span>
            </DropdownMenuItem>
            {playheadSegment && (
              <DropdownMenuItem
                className="cursor-pointer gap-2 py-1.5 px-2 text-sm"
                onClick={() =>
                  applyAdd(
                    t('addOutro'),
                    addPinnedMove(motionClips, mediaSegments, playheadSegment.id, 'end'),
                  )
                }
              >
                <IconMotion size={12} />
                <span>{t('addOutro')}</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {noRoom && <p className="text-sm text-sf-secondary">{t('noRoom')}</p>}
      </div>

      {/* Clip list */}
      <div className="mt-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-6">
        {clips.length === 0 && (
          <div className={WIDGET_EMPTY_STATE_CLASS}>
            <IconMotion size={34} className="text-sf-muted" />
            <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noMotion')}</div>
            <p className="text-sm text-sf-secondary">{t('noMotionDesc')}</p>
          </div>
        )}

        {clips.map((clip) => {
          const group = getMotionGroup(clip);
          // Looping moves have no single start and end, so Feel and Advanced don't apply.
          const isSway = Boolean(MOTION_MOVES[clip.move].sway);
          const isExpanded = expandedId === clip.id;
          const isPlayheadActive = playheadClipId === clip.id;
          const isHighlighted = isExpanded || isPlayheadActive;
          const isAdvancedExpanded = advancedExpandedIds[clip.id] ?? false;
          const poses = getClipPoses(clip);
          const moveName = t(`move_${clip.move}`);

          return (
            <div
              key={clip.id}
              ref={(node) => {
                clipRefs.current[clip.id] = node;
              }}
              className={cn(
                'overflow-hidden rounded-md border bg-sf-panel transition-[border-color,box-shadow,background-color]',
                isHighlighted
                  ? 'border-sf-border-lt bg-[#151519] shadow-[0_0_0_1px_var(--color-sf-border-lt),0_10px_24px_rgba(0,0,0,0.18)]'
                  : 'border-sf-border hover:border-sf-border-lt',
              )}
              style={{ overflow: 'hidden' }}
            >
              {/* Row header */}
              <div className="group flex items-center gap-2 px-2 py-2 cursor-pointer hover:bg-white/[0.02] rounded-t-md transition-colors">
                <button
                  type="button"
                  className={cn(
                    'min-w-0 flex flex-1 cursor-pointer items-center rounded-md px-0.5 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sf-border-lt',
                    isPlayheadActive && 'text-sf-primary',
                  )}
                  aria-expanded={isExpanded}
                  aria-current={isPlayheadActive ? 'true' : undefined}
                  onClick={() => {
                    if (!isExpanded) {
                      expand(clip);
                      if (!isPlayheadActive) {
                        requestSeekTo(clip.start);
                      }
                      return;
                    }
                    setSelectedClip(null);
                    setManualExpandedId(null);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-md font-medium font-mono text-sf-primary">
                        {moveName}
                      </div>
                      {group !== 'during' && (
                        <span className={BADGE_CLASS}>{t(`group_${group}`)}</span>
                      )}
                      {isPlayheadActive && <span className={BADGE_CLASS}>{t('live')}</span>}
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 text-sm font-mono text-sf-secondary',
                        isPlayheadActive && 'text-sf-primary/85',
                      )}
                    >
                      {formatTime(clip.start)} → {formatTime(clip.end)}
                    </div>
                  </div>
                </button>

                <Button
                  variant="ghost"
                  className={cn(
                    'transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
                    isHighlighted ? 'opacity-100' : 'opacity-0',
                  )}
                  size="icon-xs"
                  aria-label={t('ariaDelete', { move: moveName })}
                  onClick={() => {
                    commitEdit('Delete motion', (state) => ({
                      motionClips: state.motionClips.filter((c) => c.id !== clip.id),
                      selectedClip: null,
                    }));
                    if (expandedId === clip.id || manualExpandedId === clip.id) {
                      setManualExpandedId(null);
                    }
                  }}
                  title="Delete"
                >
                  <IconX />
                </Button>
              </div>

              {/* Expanded config panel */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    key="panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="border-t border-sf-border px-3 py-3 flex flex-col gap-3">
                      <div className="flex flex-col gap-3">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('move')}</div>
                        <Select
                          value={clip.move}
                          onValueChange={(v) =>
                            updateClip(t('move'), clip.id, (c) => setClipMove(c, v as MotionMoveId))
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {MOTION_TONES.map((tone, i) => {
                              const moves = movesInGroup(group).filter(
                                (m) => MOTION_MOVES[m].tone === tone,
                              );
                              if (moves.length === 0) {
                                return null;
                              }
                              return (
                                <SelectGroup key={tone}>
                                  {i > 0 && <SelectSeparator />}
                                  <SelectLabel>{t(`tone_${tone}`)}</SelectLabel>
                                  {moves.map((move) => (
                                    <SelectItem
                                      key={move}
                                      value={move}
                                      {...bindPreview(
                                        `move-${move}`,
                                        setClipMove(clip, move),
                                        t(`move_${move}`),
                                        t(`desc_${move}`),
                                        move === clip.move,
                                      )}
                                    >
                                      {t(`move_${move}`)}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {clip.shortened && (
                          <p className="text-sm text-sf-secondary">{t('shortened')}</p>
                        )}
                      </div>

                      {!clip.custom && (
                        <div className="flex flex-col gap-3">
                          <div className={WIDGET_SECTION_HEADING_CLASS}>{t('amount')}</div>
                          <ToggleGroup
                            type="single"
                            size="sm"
                            value={clip.amount}
                            onValueChange={(v) => {
                              if (v) {
                                updateClip(t('amount'), clip.id, (c) => ({
                                  ...c,
                                  amount: v as MotionAmount,
                                }));
                              }
                            }}
                            className="w-full"
                          >
                            {MOTION_AMOUNTS.map((a) => (
                              <ToggleGroupItem
                                key={a}
                                value={a}
                                size="sm"
                                className="flex-1 text-md"
                                {...bindPreview(
                                  `amount-${a}`,
                                  { ...clip, amount: a },
                                  t(`amount_${a}`),
                                  t(`desc_amount_${a}`),
                                  a === clip.amount,
                                )}
                              >
                                {t(`amount_${a}`)}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </div>
                      )}

                      {!isSway && (
                        <div className="flex flex-col gap-3">
                          <div className={WIDGET_SECTION_HEADING_CLASS}>{t('feel')}</div>
                          <ToggleGroup
                            type="single"
                            size="sm"
                            value={clip.feel}
                            onValueChange={(v) => {
                              if (v) {
                                updateClip(t('feel'), clip.id, (c) => ({
                                  ...c,
                                  feel: v as MotionFeel,
                                }));
                              }
                            }}
                            className="w-full"
                          >
                            {MOTION_FEELS.map((f) => (
                              <ToggleGroupItem
                                key={f}
                                value={f}
                                size="sm"
                                className="flex-1 text-md"
                                {...bindPreview(
                                  `feel-${f}`,
                                  { ...clip, feel: f },
                                  t(`feel_${f}`),
                                  t(`desc_feel_${f}`),
                                  f === clip.feel,
                                )}
                              >
                                {t(`feel_${f}`)}
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                        </div>
                      )}

                      {/* Advanced controls */}
                      {!isSway && (
                        <div className="border-t border-sf-border pt-1">
                          <button
                            type="button"
                            aria-expanded={isAdvancedExpanded}
                            onClick={() => toggleAdvanced(clip.id)}
                            className="flex min-h-8 w-full cursor-pointer items-center justify-between rounded-md px-0.5 text-left text-sm font-medium text-sf-secondary outline-none transition-colors duration-150 hover:text-sf-primary focus-visible:ring-2 focus-visible:ring-sf-border-lt"
                          >
                            <span>{t('advanced')}</span>
                            <IconChevronDown
                              aria-hidden
                              size={14}
                              stroke={1.5}
                              className={cn(
                                'mr-0.5 transition-transform duration-200 ease-out',
                                isAdvancedExpanded && 'rotate-180',
                              )}
                            />
                          </button>
                          <AnimatePresence initial={false}>
                            {isAdvancedExpanded && (
                              <motion.div
                                key="advanced"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18, ease: 'easeOut' }}
                                style={{ overflow: 'hidden' }}
                              >
                                <div className="flex flex-col gap-2 pt-2">
                                  <div className="flex items-center gap-1.5">
                                    <ToggleGroup
                                      type="single"
                                      size="sm"
                                      value={poseSide}
                                      onValueChange={(v) => {
                                        if (v) {
                                          setPoseSide(v as keyof MotionPoses);
                                          requestPauseAndSeekTo(
                                            v === 'from'
                                              ? clip.start
                                              : Math.max(clip.start, clip.end - 0.01),
                                          );
                                        }
                                      }}
                                      className="w-full"
                                    >
                                      <ToggleGroupItem
                                        value="from"
                                        size="sm"
                                        className="flex-1 text-md"
                                        {...bindPreview(
                                          `pose-from-${clip.id}`,
                                          clip,
                                          t('pose_from'),
                                          t('desc_pose_from'),
                                          poseSide === 'from',
                                          'from',
                                        )}
                                      >
                                        {t('pose_from')}
                                      </ToggleGroupItem>
                                      <ToggleGroupItem
                                        value="to"
                                        size="sm"
                                        className="flex-1 text-md"
                                        {...bindPreview(
                                          `pose-to-${clip.id}`,
                                          clip,
                                          t('pose_to'),
                                          t('desc_pose_to'),
                                          poseSide === 'to',
                                          'to',
                                        )}
                                      >
                                        {t('pose_to')}
                                      </ToggleGroupItem>
                                    </ToggleGroup>
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      aria-label={t('swap')}
                                      onClick={() => updateClip(t('swap'), clip.id, swapClipPoses)}
                                      {...bindPreview(
                                        `swap-${clip.id}`,
                                        swapClipPoses(clip),
                                        t('swap'),
                                        t('desc_swap'),
                                        false,
                                      )}
                                    >
                                      <IconSwap />
                                    </Button>
                                  </div>
                                  {SCENE_MOTION_PROPS.map((prop) => {
                                    const spec = SCENE_MOTION_SPECS[prop];
                                    const value = poses[poseSide][prop];
                                    const groupKey = `motion-${prop}-${clip.id}`;
                                    return (
                                      <Slider
                                        key={prop}
                                        {...preview.bind(
                                          `pose-${clip.id}-${prop}`,
                                          renderLivePose(clip.id, poseSide, prop),
                                        )}
                                        min={spec.min}
                                        max={spec.max}
                                        step={spec.step}
                                        inlineLabel={t(`prop_${prop}`)}
                                        valueLabel={FORMAT[prop](value)}
                                        value={[value]}
                                        onPointerDown={(e) => {
                                          beginHistoryGroup(groupKey, t(`prop_${prop}`));
                                          sliderAnchor.current = e.currentTarget;
                                          presentPose(clip.id, poseSide, prop);
                                        }}
                                        onValueChange={([v]) => {
                                          if (v !== undefined) {
                                            updateClip(t(`prop_${prop}`), clip.id, (c) =>
                                              setClipPoseValue(c, poseSide, prop, v),
                                            );
                                            presentPose(clip.id, poseSide, prop);
                                          }
                                        }}
                                        onValueCommit={() => {
                                          endHistoryGroup(groupKey);
                                          sliderAnchor.current = null;
                                          preview.release();
                                        }}
                                      />
                                    );
                                  })}
                                  {clip.custom && (
                                    <div className="flex items-center justify-between gap-2 pt-1">
                                      <span className="text-sm text-sf-secondary">
                                        {t('customHint')}
                                      </span>
                                      <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={t('resetCustom', { move: moveName })}
                                        title={t('resetCustom', { move: moveName })}
                                        onClick={() =>
                                          updateClip(t('resetCustom'), clip.id, resetClipCustom)
                                        }
                                      >
                                        <IconRestart />
                                      </Button>
                                    </div>
                                  )}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};
