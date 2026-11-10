import {
  IconAiMagic,
  IconChevronDown,
  IconPlus,
  IconX,
  IconZoom,
  IconZoomScan,
} from 'src/lib/icons';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { trackEvent } from 'src/lib/analytics';
import { ZoomPositionPicker } from './_components/ZoomWidgetPositionPicker';
import {
  ADD_ZOOM_FALLBACK_SCALE,
  ADD_ZOOM_MIN_CONFIDENCE,
  defaultCinematicZoomClip,
  defaultZoomClip,
  inferZoomDefaultsAtTime,
} from 'src/lib/effects/zoom';
import { normalizeZoomEasing } from 'src/lib/effects/zoom/clip';
import {
  applyZoomStyle,
  ZOOM_EASINGS,
  ZOOM_INTENSITY_MAX,
  ZOOM_INTENSITY_MIN,
} from 'src/lib/effects/zoom/style';
import type { CinematicTiltDirection, ZoomEasing } from 'src/types/timeline';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Slider,
  ToggleGroup,
  ToggleGroupItem,
} from 'src/lib/ui';
import { useStore } from 'src/store';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { cn, formatTime } from 'src/lib/utils';

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

const EASING_LABEL_KEYS: Record<ZoomEasing, string> = {
  gentle: 'easingGentle',
  standard: 'easingStandard',
  snappy: 'easingSnappy',
};

export const ZoomWidget = () => {
  const { t } = useTranslation('zoom');
  const [manualExpandedId, setManualExpandedId] = useState<string | null>(null);
  const [advancedExpandedIds, setAdvancedExpandedIds] = useState<Record<string, boolean>>({});
  const clipRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const {
    recordingResult,
    zoomClips,
    zoomStyle,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
    setSelectedClip,
    currentTime,
    selectedClip,
    requestSeekTo,
  } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      zoomClips: state.zoomClips,
      zoomStyle: state.zoomStyle,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
      setSelectedClip: state.setSelectedClip,
      currentTime: state.currentTime,
      selectedClip: state.selectedClip,
      requestSeekTo: state.requestSeekTo,
    })),
  );

  const expandedId = selectedClip?.effectId === 'zoom' ? selectedClip.id : manualExpandedId;
  const playheadClipId =
    zoomClips.find((clip) => currentTime >= clip.start && currentTime <= clip.end)?.id ?? null;

  useEffect(() => {
    if (!playheadClipId) {
      return;
    }
    clipRefs.current[playheadClipId]?.scrollIntoView({ block: 'nearest' });
  }, [playheadClipId]);

  const handleAddZoom = (preset: 'standard' | 'cinematic' = 'standard') => {
    const start = currentTime;
    const defaults = inferZoomDefaultsAtTime(recordingResult, currentTime);
    const scale =
      defaults.confidence >= ADD_ZOOM_MIN_CONFIDENCE ? defaults.scale : ADD_ZOOM_FALLBACK_SCALE;
    const clip =
      preset === 'cinematic'
        ? defaultCinematicZoomClip(
            `zoom-${Date.now()}`,
            start,
            start + 3,
            defaults.cx,
            defaults.cy,
            Math.max(scale, 2.2),
          )
        : defaultZoomClip(`zoom-${Date.now()}`, start, start + 3, defaults.cx, defaults.cy, scale);
    commitEdit(preset === 'cinematic' ? 'Add cinematic zoom clip' : 'Add zoom clip', (state) => ({
      zoomClips: [...state.zoomClips, { ...clip, easing: state.zoomStyle.easing }].sort(
        (a, b) => a.start - b.start,
      ),
    }));
    trackEvent('zoom_clip_added', { source: 'widget', scale: clip.scale, preset });
    setManualExpandedId(clip.id);
  };

  const updateClip = (label: string, clipId: string, patch: Partial<(typeof zoomClips)[number]>) =>
    commitEdit(label, (state) => ({
      zoomClips: state.zoomClips
        .map((c) => (c.id === clipId ? { ...c, ...patch } : c))
        .sort((a, b) => a.start - b.start),
    }));

  const trackZoom = (property: string, value: unknown) =>
    trackEvent('widget_config_changed', { widget: 'zoom', property, value });

  const toggleAdvanced = (clipId: string) => {
    setAdvancedExpandedIds((current) => ({
      ...current,
      [clipId]: !current[clipId],
    }));
  };

  if (!recordingResult) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={WIDGET_PANEL_HEADER_CLASS}>
          <IconZoom className="size-4.5" />
          {t('header')}
        </div>

        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconZoom size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={WIDGET_PANEL_HEADER_CLASS}>
        <IconZoom className="size-4.5" />
        {t('header')}
      </div>

      {/* Actions */}
      <div className="shrink-0 px-3 flex flex-col gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="md"
              variant="secondary"
              className="w-full gap-1.5"
              disabled={!recordingResult}
            >
              <IconPlus size={14} />
              {t('addZoom')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="center" className="w-48 p-1">
            <DropdownMenuItem
              className="cursor-pointer gap-2 py-1.5 px-2 text-sm"
              onClick={() => handleAddZoom('standard')}
            >
              <IconZoom size={12} />
              <span>{t('addStandardZoom')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer gap-2 py-1.5 px-2 text-sm"
              onClick={() => handleAddZoom('cinematic')}
            >
              <IconAiMagic size={12} />
              <span>{t('addCinematicZoom')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Auto-zoom style — project-wide, saved in style presets */}
      <div className="mt-4 shrink-0 px-3 flex flex-col gap-3">
        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('autoZoomStyle')}</div>
        <div className="flex flex-col gap-1.5">
          <Slider
            min={ZOOM_INTENSITY_MIN}
            max={ZOOM_INTENSITY_MAX}
            step={0.05}
            inlineLabel={t('intensity')}
            valueLabel={formatPercent(zoomStyle.intensity)}
            value={[zoomStyle.intensity]}
            onPointerDown={() => beginHistoryGroup('zoom-intensity', 'Adjust zoom intensity')}
            onValueChange={([v]) =>
              commitEdit('Adjust zoom intensity', (state) =>
                applyZoomStyle(state, { intensity: v }),
              )
            }
            onValueCommit={([v]) => {
              endHistoryGroup('zoom-intensity');
              trackZoom('intensity', v);
            }}
          />
          <p className="text-[11.5px] text-sf-muted">{t('intensityHint')}</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className={WIDGET_SECTION_HEADING_CLASS}>{t('easing')}</span>
          <ToggleGroup
            type="single"
            size="sm"
            value={zoomStyle.easing}
            onValueChange={(v) => {
              if (v) {
                commitEdit('Change zoom easing', (state) =>
                  applyZoomStyle(state, { easing: normalizeZoomEasing(v) }),
                );
                trackZoom('easing', v);
              }
            }}
            className="w-full"
          >
            {ZOOM_EASINGS.map((easing) => (
              <ToggleGroupItem key={easing} value={easing} size="sm" className="flex-1 text-md">
                {t(EASING_LABEL_KEYS[easing])}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      {/* Clip list */}
      <div className="mt-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-6">
        {zoomClips.length === 0 && (
          <div className={WIDGET_EMPTY_STATE_CLASS}>
            <IconZoomScan size={34} className="text-sf-muted" />
            <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noZoomClips')}</div>
          </div>
        )}

        {zoomClips.map((clip) => {
          const isExpanded = expandedId === clip.id;
          const isPlayheadActive = playheadClipId === clip.id;
          const isHighlighted = isExpanded || isPlayheadActive;
          const isAdvancedExpanded = advancedExpandedIds[clip.id] ?? false;

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
                    const isPlayheadOverClip =
                      currentTime >= clip.start + 0.5 && currentTime <= clip.end;

                    if (!isExpanded) {
                      setSelectedClip({
                        id: clip.id,
                        start: clip.start,
                        end: clip.end,
                        effectId: 'zoom',
                      });
                      setManualExpandedId(clip.id);

                      if (!isPlayheadOverClip) {
                        requestSeekTo((clip.start + clip.end) / 2);
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
                        {clip.preset === 'cinematic'
                          ? t('cinematicZoom')
                          : t('xZoom', { scale: clip.scale.toFixed(1) })}
                      </div>
                      {clip.preset === 'cinematic' && (
                        <span className="rounded-full border border-sf-border-lt/70 bg-sf-border-lt/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-primary">
                          {clip.scale.toFixed(1)}×
                        </span>
                      )}
                      {isPlayheadActive && (
                        <span className="rounded-full border border-sf-border-lt/70 bg-sf-border-lt/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-primary">
                          {t('live')}
                        </span>
                      )}
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
                  aria-label={
                    clip.preset === 'cinematic'
                      ? t('ariaDeleteCinematic')
                      : t('ariaDelete', { scale: clip.scale.toFixed(1) })
                  }
                  onClick={() => {
                    commitEdit('Delete zoom clip', (state) => ({
                      zoomClips: state.zoomClips.filter((c) => c.id !== clip.id),
                      selectedClip: null,
                    }));
                    trackEvent('zoom_clip_deleted', {
                      source: 'widget',
                      preset: clip.preset,
                      scale: clip.scale,
                      duration_seconds: Math.round((clip.end - clip.start) * 100) / 100,
                    });
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
                      {clip.preset !== 'cinematic' && (
                        <div className="flex flex-col gap-3">
                          <div className={WIDGET_SECTION_HEADING_CLASS}>{t('zoomMode')}</div>
                          <ToggleGroup
                            type="single"
                            size="sm"
                            value={clip.mode}
                            onValueChange={(v) => {
                              if (v) {
                                updateClip('Change zoom mode', clip.id, {
                                  mode: v as 'auto' | 'manual',
                                });
                                trackZoom('mode', v);
                              }
                            }}
                            className="w-full"
                          >
                            <ToggleGroupItem value="auto" size="sm" className="flex-1 text-md">
                              {t('auto')}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="manual" size="sm" className="flex-1 text-md">
                              {t('manual')}
                            </ToggleGroupItem>
                          </ToggleGroup>

                          {clip.mode === 'manual' && recordingResult && (
                            <div className="flex flex-col gap-1.5">
                              <ZoomPositionPicker
                                videoPath={recordingResult.filePath}
                                videoTime={currentTime}
                                cx={clip.cx}
                                cy={clip.cy}
                                scale={clip.scale}
                                onDragStart={() =>
                                  beginHistoryGroup(
                                    `zoom-position-${clip.id}`,
                                    'Reposition zoom target',
                                  )
                                }
                                onDragEnd={() => endHistoryGroup(`zoom-position-${clip.id}`)}
                                onChange={(cx, cy) =>
                                  updateClip('Reposition zoom target', clip.id, { cx, cy })
                                }
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {clip.preset === 'cinematic' && (
                        <div className="flex flex-col gap-2">
                          <span className={WIDGET_SECTION_HEADING_CLASS}>{t('tiltDirection')}</span>
                          <ToggleGroup
                            type="single"
                            size="sm"
                            value={clip.cinematicTiltDirection ?? 'left'}
                            onValueChange={(v) => {
                              if (v) {
                                updateClip('Change tilt direction', clip.id, {
                                  cinematicTiltDirection: v as CinematicTiltDirection,
                                });
                                trackZoom('cinematic_tilt_direction', v);
                              }
                            }}
                            className="w-full"
                          >
                            <ToggleGroupItem value="left" className="flex-1">
                              {t('tiltDirectionLeft')}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="right" className="flex-1">
                              {t('tiltDirectionRight')}
                            </ToggleGroupItem>
                          </ToggleGroup>
                        </div>
                      )}

                      {/* Zoom level */}
                      <div className="flex flex-col gap-3">
                        <Slider
                          min={1.1}
                          max={4}
                          step={0.1}
                          inlineLabel={t('zoomLevel')}
                          valueLabel={`${clip.scale.toFixed(1)}×`}
                          value={[clip.scale]}
                          onPointerDown={() =>
                            beginHistoryGroup(`zoom-scale-${clip.id}`, 'Adjust zoom level')
                          }
                          onValueChange={([v]) =>
                            updateClip('Adjust zoom level', clip.id, { scale: v })
                          }
                          onValueCommit={([v]) => {
                            endHistoryGroup(`zoom-scale-${clip.id}`);
                            trackZoom('scale', v);
                          }}
                        />
                      </div>

                      {clip.preset === 'cinematic' && (
                        <div className="flex flex-col gap-3">
                          <Slider
                            min={0}
                            max={1}
                            step={0.05}
                            inlineLabel={t('cinematicDepth')}
                            valueLabel={formatPercent(clip.cinematicDepth)}
                            value={[clip.cinematicDepth]}
                            onPointerDown={() =>
                              beginHistoryGroup(
                                `zoom-cinematic-depth-${clip.id}`,
                                'Adjust tilt depth',
                              )
                            }
                            onValueChange={([v]) =>
                              updateClip('Adjust tilt depth', clip.id, {
                                cinematicDepth: v,
                              })
                            }
                            onValueCommit={([v]) => {
                              endHistoryGroup(`zoom-cinematic-depth-${clip.id}`);
                              trackZoom('cinematic_depth', v);
                            }}
                          />
                          <Slider
                            min={0}
                            max={1}
                            step={0.05}
                            inlineLabel={t('cinematicTilt')}
                            valueLabel={formatPercent(clip.cinematicTilt)}
                            value={[clip.cinematicTilt]}
                            onPointerDown={() =>
                              beginHistoryGroup(
                                `zoom-cinematic-tilt-${clip.id}`,
                                'Adjust cinematic tilt',
                              )
                            }
                            onValueChange={([v]) =>
                              updateClip('Adjust cinematic tilt', clip.id, {
                                cinematicTilt: v,
                              })
                            }
                            onValueCommit={([v]) => {
                              endHistoryGroup(`zoom-cinematic-tilt-${clip.id}`);
                              trackZoom('cinematic_tilt', v);
                            }}
                          />
                          <Slider
                            min={0}
                            max={1}
                            step={0.05}
                            inlineLabel={t('cinematicFocus')}
                            valueLabel={formatPercent(clip.cinematicFocus)}
                            value={[clip.cinematicFocus]}
                            onPointerDown={() =>
                              beginHistoryGroup(
                                `zoom-cinematic-focus-${clip.id}`,
                                'Adjust focus size',
                              )
                            }
                            onValueChange={([v]) =>
                              updateClip('Adjust focus size', clip.id, {
                                cinematicFocus: v,
                              })
                            }
                            onValueCommit={([v]) => {
                              endHistoryGroup(`zoom-cinematic-focus-${clip.id}`);
                              trackZoom('cinematic_focus', v);
                            }}
                          />
                          <Slider
                            min={0}
                            max={1}
                            step={0.05}
                            inlineLabel={t('cinematicBackgroundFade')}
                            valueLabel={formatPercent(clip.cinematicBackgroundFade)}
                            value={[clip.cinematicBackgroundFade]}
                            onPointerDown={() =>
                              beginHistoryGroup(
                                `zoom-cinematic-fade-${clip.id}`,
                                'Adjust background fade',
                              )
                            }
                            onValueChange={([v]) =>
                              updateClip('Adjust background fade', clip.id, {
                                cinematicBackgroundFade: v,
                              })
                            }
                            onValueCommit={([v]) => {
                              endHistoryGroup(`zoom-cinematic-fade-${clip.id}`);
                              trackZoom('cinematic_background_fade', v);
                            }}
                          />
                        </div>
                      )}

                      {/* Advanced controls */}
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
                                <Slider
                                  min={0}
                                  max={Math.max(0.1, (clip.end - clip.start) / 2)}
                                  step={0.05}
                                  inlineLabel={t('easeIn')}
                                  valueLabel={`${clip.easeIn.toFixed(2)}s`}
                                  value={[clip.easeIn]}
                                  onPointerDown={() =>
                                    beginHistoryGroup(`zoom-easein-${clip.id}`, 'Adjust ease in')
                                  }
                                  onValueChange={([v]) =>
                                    updateClip('Adjust ease in', clip.id, { easeIn: v })
                                  }
                                  onValueCommit={() => endHistoryGroup(`zoom-easein-${clip.id}`)}
                                />
                                <Slider
                                  min={0}
                                  max={Math.max(0.1, (clip.end - clip.start) / 2)}
                                  step={0.05}
                                  inlineLabel={t('easeOut')}
                                  valueLabel={`${clip.easeOut.toFixed(2)}s`}
                                  value={[clip.easeOut]}
                                  onPointerDown={() =>
                                    beginHistoryGroup(`zoom-easeout-${clip.id}`, 'Adjust ease out')
                                  }
                                  onValueChange={([v]) =>
                                    updateClip('Adjust ease out', clip.id, { easeOut: v })
                                  }
                                  onValueCommit={() => endHistoryGroup(`zoom-easeout-${clip.id}`)}
                                />
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
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
