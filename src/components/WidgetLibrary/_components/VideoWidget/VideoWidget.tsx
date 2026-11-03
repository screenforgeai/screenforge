import { IconFilm, IconX } from 'src/lib/icons';
import { trackEvent } from 'src/lib/analytics';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
  Button,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Slider,
} from 'src/lib/ui';
import { useStore } from 'src/store';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { cn, formatTime } from 'src/lib/utils';
import { sortMediaSegments, getEffectiveTransitionOut } from 'src/lib/helpers/segments';
import type { ClipTransition, TransitionType } from 'src/types/timeline';
import { DEFAULT_CLIP_TRANSITION } from 'src/types/timeline';

// ── Transition picker data ────────────────────────────────────────────────────

interface TransitionOption {
  type: TransitionType;
  labelKey: string;
}

const TRANSITION_CATEGORIES: { labelKey: string; options: TransitionOption[] }[] = [
  {
    labelKey: 'categoryBasic',
    options: [
      { type: 'none', labelKey: 'transitionNone' },
      { type: 'fade', labelKey: 'transitionFade' },
      { type: 'fade-white', labelKey: 'transitionFadeWhite' },
    ],
  },
  {
    labelKey: 'categorySlide',
    options: [
      { type: 'slide-up', labelKey: 'transitionSlideUp' },
      { type: 'slide-down', labelKey: 'transitionSlideDown' },
      { type: 'slide-left', labelKey: 'transitionSlideLeft' },
      { type: 'slide-right', labelKey: 'transitionSlideRight' },
    ],
  },
  {
    labelKey: 'categoryScale',
    options: [
      { type: 'grow', labelKey: 'transitionGrow' },
      { type: 'shrink', labelKey: 'transitionShrink' },
    ],
  },
  {
    labelKey: 'categoryBlur',
    options: [{ type: 'blur', labelKey: 'transitionBlur' }],
  },
];

// ── TransitionPicker ──────────────────────────────────────────────────────────

const TransitionPicker = ({
  value,
  onChange,
  onDurationPointerDown,
  onDurationCommit,
}: {
  value: ClipTransition;
  onChange: (t: ClipTransition) => void;
  onDurationPointerDown: () => void;
  onDurationCommit: () => void;
}) => {
  const { t } = useTranslation('video');

  return (
    <div className="flex flex-col gap-3">
      <Select
        value={value.type}
        onValueChange={(v) => onChange({ ...value, type: v as TransitionType })}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {TRANSITION_CATEGORIES.map((cat, i) => (
            <SelectGroup key={cat.labelKey}>
              {i > 0 && <SelectSeparator />}
              <SelectLabel>{t(cat.labelKey)}</SelectLabel>
              {cat.options.map((opt) => (
                <SelectItem key={opt.type} value={opt.type}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      {value.type !== 'none' && (
        <Slider
          min={0.05}
          max={1.5}
          step={0.05}
          inlineLabel={t('duration')}
          valueLabel={`${value.duration.toFixed(2)}s`}
          value={[value.duration]}
          onPointerDown={onDurationPointerDown}
          onValueChange={([v]) => onChange({ ...value, duration: v })}
          onValueCommit={onDurationCommit}
        />
      )}
    </div>
  );
};

// ── VideoWidget ───────────────────────────────────────────────────────────────

export const VideoWidget = () => {
  const { t } = useTranslation('video');
  const clipRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const {
    recordingResult,
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

  const orderedSegments = sortMediaSegments(mediaSegments);

  const expandedId = selectedClip?.effectId === 'video' ? selectedClip.id : null;

  const playheadSegmentId =
    orderedSegments.find((seg) => currentTime >= seg.timelineStart && currentTime < seg.timelineEnd)
      ?.id ?? null;

  useEffect(() => {
    if (!playheadSegmentId) {
      return;
    }
    clipRefs.current[playheadSegmentId]?.scrollIntoView({ block: 'nearest' });
  }, [playheadSegmentId]);

  const updateTransitionOut = (segmentId: string, transition: ClipTransition) => {
    trackEvent('widget_config_changed', {
      widget: 'video',
      property: 'transitionOut',
      value: transition.type,
    });
    commitEdit('Update transition out', (state) => ({
      mediaSegments: state.mediaSegments.map((s) =>
        s.id === segmentId ? { ...s, transitionOut: transition } : s,
      ),
    }));
  };

  const updateTransitionIn = (segmentId: string, transition: ClipTransition) => {
    trackEvent('widget_config_changed', {
      widget: 'video',
      property: 'transitionIn',
      value: transition.type,
    });
    commitEdit('Update transition in', (state) => ({
      mediaSegments: state.mediaSegments.map((s) =>
        s.id === segmentId ? { ...s, transitionIn: transition } : s,
      ),
    }));
  };

  const updateSpeed = (segmentId: string, speed: number) => {
    trackEvent('widget_config_changed', {
      widget: 'video',
      property: 'speed',
      value: speed,
    });
    commitEdit('Update clip speed', (state) => {
      const affectedSegment = state.mediaSegments.find((s) => s.id === segmentId);
      if (!affectedSegment) {
        return {};
      }

      const sourceDuration = affectedSegment.sourceEnd - affectedSegment.sourceStart;
      const segStart = affectedSegment.timelineStart;
      const oldEnd = affectedSegment.timelineEnd;
      const newEnd = segStart + sourceDuration / speed;
      const segDuration = oldEnd - segStart;
      // Positive when clip grows (speed < 1), negative when it shrinks (speed > 1).
      const delta = newEnd - oldEnd;

      // 1 ns tolerance — far above any fp rounding (~1e-14 s) and far below
      // MIN_CAMERA_CLIP_DURATION (0.1 s), so it never absorbs intentional boundaries.
      const EPS = 1e-9;
      const remapTime = (t: number): number => {
        if (t <= segStart || segDuration === 0) {
          return t;
        }
        if (t > oldEnd + EPS) {
          // Ripple-shift anything that falls after the old segment boundary.
          return t + delta;
        }
        // t is at or near the segment end — snap directly to newEnd to prevent
        // fp drift from (oldEnd * newEnd)/oldEnd accumulating across speed changes.
        if (t >= oldEnd - EPS) {
          return newEnd;
        }
        return segStart + ((t - segStart) * (newEnd - segStart)) / segDuration;
      };

      return {
        mediaSegments: state.mediaSegments.map((s) => {
          if (s.id === segmentId) {
            return { ...s, speed, timelineEnd: newEnd };
          }
          // Ripple-shift every segment that starts at or after the old boundary.
          if (s.timelineStart >= oldEnd - EPS) {
            return {
              ...s,
              timelineStart: s.timelineStart + delta,
              timelineEnd: s.timelineEnd + delta,
            };
          }
          return s;
        }),
        cameraMediaSegments: state.cameraMediaSegments.map((s) => {
          // Camera segments have different IDs than video segments; match by
          // timeline position instead. Both start and end must align to avoid
          // accidentally speed-changing a camera segment that spans multiple
          // video segments (e.g. in projects created before camera splitting).
          if (
            Math.abs(s.timelineStart - segStart) < EPS &&
            Math.abs(s.timelineEnd - oldEnd) < EPS
          ) {
            const camSourceDuration = s.sourceEnd - s.sourceStart;
            return { ...s, speed, timelineEnd: s.timelineStart + camSourceDuration / speed };
          }
          if (s.timelineStart >= oldEnd - EPS) {
            return {
              ...s,
              timelineStart: s.timelineStart + delta,
              timelineEnd: s.timelineEnd + delta,
            };
          }
          return s;
        }),
        zoomClips: state.zoomClips.map((clip) => ({
          ...clip,
          start: remapTime(clip.start),
          end: remapTime(clip.end),
        })),
        cameraClips: state.cameraClips.map((clip) => ({
          ...clip,
          start: remapTime(clip.start),
          end: remapTime(clip.end),
        })),
        musicClips: state.musicClips.map((clip) => {
          if (clip.timelineStart >= oldEnd - EPS) {
            return {
              ...clip,
              timelineStart: clip.timelineStart + delta,
              timelineEnd: clip.timelineEnd + delta,
            };
          }
          return clip;
        }),
      };
    });
    requestPauseAndSeekTo(0);
  };

  if (!recordingResult) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={WIDGET_PANEL_HEADER_CLASS}>
          <IconFilm className="size-4.5" />
          {t('header')}
        </div>
        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconFilm size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={WIDGET_PANEL_HEADER_CLASS}>
        <IconFilm className="size-4.5" />
        {t('header')}
      </div>

      <div className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-6">
        {orderedSegments.length === 0 && (
          <div className={WIDGET_EMPTY_STATE_CLASS}>
            <IconFilm size={34} className="text-sf-muted" />
            <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noClips')}</div>
          </div>
        )}

        {orderedSegments.map((seg, index) => {
          const isExpanded = expandedId === seg.id;
          const isPlayheadActive = playheadSegmentId === seg.id;
          const isHighlighted = isExpanded || isPlayheadActive;
          const clipDuration = seg.timelineEnd - seg.timelineStart;
          const effectiveIn: ClipTransition = seg.transitionIn ?? DEFAULT_CLIP_TRANSITION;
          const effectiveOut: ClipTransition = getEffectiveTransitionOut(seg);
          const effectiveSpeed = seg.speed ?? 1;
          const speedLabel = effectiveSpeed % 1 === 0 ? `${effectiveSpeed}×` : `${effectiveSpeed}×`;

          return (
            <div
              key={seg.id}
              ref={(node) => {
                clipRefs.current[seg.id] = node;
              }}
              className={cn(
                'overflow-hidden rounded-md border bg-sf-panel transition-[border-color,box-shadow,background-color]',
                isHighlighted
                  ? 'border-sf-border-lt bg-[#151519] shadow-[0_0_0_1px_var(--color-sf-border-lt),0_10px_24px_rgba(0,0,0,0.18)]'
                  : 'border-sf-border hover:border-sf-border-lt',
              )}
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
                    const mid = (seg.timelineStart + seg.timelineEnd) / 2;
                    const isPlayheadOverClip =
                      currentTime >= seg.timelineStart && currentTime < seg.timelineEnd;

                    if (!isExpanded) {
                      setSelectedClip({
                        id: seg.id,
                        start: seg.timelineStart,
                        end: seg.timelineEnd,
                        effectId: 'video',
                      });
                      if (!isPlayheadOverClip) {
                        requestSeekTo(mid);
                      }
                      return;
                    }

                    setSelectedClip(null);
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-md font-medium font-mono text-sf-primary">
                        {t('clipN', { n: index + 1 })}
                      </div>
                      {isPlayheadActive && (
                        <span className="rounded-full border border-sf-border-lt/70 bg-sf-border-lt/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-primary">
                          {t('live')}
                        </span>
                      )}
                      {effectiveSpeed !== 1 && (
                        <span className="rounded border border-sf-border/60 bg-sf-border/20 px-1 py-0.5 font-mono text-[10px] leading-none text-sf-secondary">
                          {speedLabel}
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 text-sm font-mono text-sf-secondary',
                        isPlayheadActive && 'text-sf-primary/85',
                      )}
                    >
                      {formatTime(seg.timelineStart)} → {formatTime(seg.timelineEnd)}
                      <span className="ml-2 opacity-50">({formatTime(clipDuration)})</span>
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
                  aria-label={t('ariaDelete', { n: index + 1 })}
                  onClick={() => {
                    trackEvent('video_clip_deleted', { source: 'widget' });
                    commitEdit('Delete video clip', (state) => ({
                      mediaSegments: state.mediaSegments.filter((s) => s.id !== seg.id),
                      selectedClip: null,
                    }));
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
                    <div className="border-t border-sf-border px-3 py-3 flex flex-col gap-4">
                      {/* Speed */}
                      <div className="flex flex-col gap-2">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('speed')}</div>
                        <Slider
                          min={0.25}
                          max={4}
                          step={0.25}
                          inlineLabel={t('speed')}
                          valueLabel={speedLabel}
                          value={[effectiveSpeed]}
                          onPointerDown={() =>
                            beginHistoryGroup(`speed-${seg.id}`, 'Adjust clip speed')
                          }
                          onValueChange={([v]) => updateSpeed(seg.id, v)}
                          onValueCommit={() => endHistoryGroup(`speed-${seg.id}`)}
                        />
                      </div>

                      {/* Transition In */}
                      <div className="flex flex-col gap-2">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('tabIn')}</div>
                        <TransitionPicker
                          value={effectiveIn}
                          onChange={(tr) => updateTransitionIn(seg.id, tr)}
                          onDurationPointerDown={() =>
                            beginHistoryGroup(`tr-in-dur-${seg.id}`, 'Adjust transition duration')
                          }
                          onDurationCommit={() => endHistoryGroup(`tr-in-dur-${seg.id}`)}
                        />
                      </div>

                      {/* Transition Out */}
                      <div className="flex flex-col gap-2">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('tabOut')}</div>
                        <TransitionPicker
                          value={effectiveOut}
                          onChange={(tr) => updateTransitionOut(seg.id, tr)}
                          onDurationPointerDown={() =>
                            beginHistoryGroup(`tr-out-dur-${seg.id}`, 'Adjust transition duration')
                          }
                          onDurationCommit={() => endHistoryGroup(`tr-out-dur-${seg.id}`)}
                        />
                      </div>
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
