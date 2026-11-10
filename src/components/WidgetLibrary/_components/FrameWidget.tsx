import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { trackEvent } from 'src/lib/analytics';
import { useShallow } from 'zustand/react/shallow';
import {
  preloadWallpapers,
  GRADIENT_PRESETS,
  WALLPAPER_PRESETS,
  CUSTOM_WALLPAPER_SEED,
  getCustomWallpaperUrl,
  setCustomWallpaperUrl,
  subscribeCustomWallpaper,
} from 'src/lib/effects/frame';
import { getInitialPlaybackTime } from 'src/lib/helpers/segments';
import { useStore } from '../../../store';
import type { BackgroundSettings, BackgroundType } from '../../../store';
import { Button, Slider, ToggleGroup, ToggleGroupItem } from '../../../lib/ui';
import { cn } from 'src/lib/utils';
import { IconPhoto, IconPlus } from 'src/lib/icons';
import { LogoSection } from './LogoSection';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';

const BG_TAB_VALUES: BackgroundType[] = ['wallpaper', 'solid'];

const ANGLE_PRESETS = [
  { label: '↓', value: 180 },
  { label: '↙', value: 225 },
  { label: '→', value: 90 },
  { label: '↗', value: 45 },
  { label: '↑', value: 0 },
];

export const FrameWidget = () => {
  const { t } = useTranslation('frame');
  const {
    activeWidget,
    frame,
    recordingResult,
    mediaSegments,
    isCropEditing,
    setIsCropEditing,
    requestPauseAndSeekTo,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
  } = useStore(
    useShallow((state) => ({
      activeWidget: state.activeWidget,
      frame: state.frame,
      recordingResult: state.recordingResult,
      mediaSegments: state.mediaSegments,
      isCropEditing: state.isCropEditing,
      setIsCropEditing: state.setIsCropEditing,
      requestPauseAndSeekTo: state.requestPauseAndSeekTo,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
    })),
  );

  // Subscribe separately to avoid unnecessary re-renders from shallow selector
  const pendingPauseSeekTime = useStore((s) => s.pendingPauseSeekTime);
  const waitingForPauseToOpenCropRef = useRef(false);

  useEffect(() => {
    if (activeWidget === 'frame') {
      return;
    }

    waitingForPauseToOpenCropRef.current = false;
  }, [activeWidget]);

  useEffect(() => {
    if (
      waitingForPauseToOpenCropRef.current &&
      pendingPauseSeekTime === null &&
      activeWidget === 'frame'
    ) {
      waitingForPauseToOpenCropRef.current = false;
      setIsCropEditing(true);
    }
  }, [activeWidget, pendingPauseSeekTime, setIsCropEditing]);

  const {
    background: {
      type,
      wallpaperSeed,
      gradientPresetId,
      gradientFrom,
      gradientTo,
      gradientAngle,
      solidColor,
      padding,
      cornerRadius,
      shadowBlur,
      shadowOpacity,
    },
  } = frame;

  useEffect(() => {
    preloadWallpapers();
  }, []);

  const fromInputRef = useRef<HTMLInputElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const solidInputRef = useRef<HTMLInputElement>(null);
  const customWallpaperInputRef = useRef<HTMLInputElement>(null);
  // A style preset can set the custom wallpaper too, so read it from its source.
  const customWallpaperPreview = useSyncExternalStore(
    subscribeCustomWallpaper,
    getCustomWallpaperUrl,
  );
  const isCustomSelected = wallpaperSeed === CUSTOM_WALLPAPER_SEED;

  const handleCustomWallpaperPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setCustomWallpaperUrl(dataUrl);
      patchBackground('Change wallpaper', { wallpaperSeed: CUSTOM_WALLPAPER_SEED });
      trackFrame('wallpaper_seed', CUSTOM_WALLPAPER_SEED);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const isCropApplied =
    frame.cropRect.x > 0 ||
    frame.cropRect.y > 0 ||
    frame.cropRect.width < 1 ||
    frame.cropRect.height < 1;

  const commitFrameEdit = (label: string, updater: Parameters<typeof commitEdit>[1]) => {
    requestPauseAndSeekTo(getInitialPlaybackTime(mediaSegments));
    commitEdit(label, updater);
  };

  const trackFrame = (property: string, value: unknown) =>
    trackEvent('widget_config_changed', { widget: 'frame', property, value });

  const patchBackground = (label: string, patch: Partial<BackgroundSettings>) => {
    commitFrameEdit(label, (state) => ({
      frame: {
        ...state.frame,
        background: {
          ...state.frame.background,
          ...patch,
        },
      },
    }));
  };

  const handlePresetClick = (presetId: string) => {
    const preset = GRADIENT_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    patchBackground('Apply gradient preset', {
      gradientPresetId: presetId,
      gradientFrom: preset.stops[0]?.color ?? '#000000',
      gradientTo: preset.stops[preset.stops.length - 1]?.color ?? '#ffffff',
      gradientAngle: preset.angle,
    });
  };

  if (!recordingResult) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={WIDGET_PANEL_HEADER_CLASS}>
          <IconPhoto className="size-4.5" />
          {t('header')}
        </div>

        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconPhoto size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={WIDGET_PANEL_HEADER_CLASS}>
        <IconPhoto className="size-4.5" />
        {t('header')}
      </div>

      <div className="flex min-h-0 flex-1 flex-col divide-y divide-[#161515] overflow-y-auto px-4 pb-6">
        {/* <section className="flex flex-col gap-3 pb-5">
          <div>
            <div className="text-md tracking-wider text-sf-primary">Aspect Ratio</div>
          </div>

          <ToggleGroup
            type="single"
            value={aspectRatioId}
            onValueChange={(value) => value && handleAspectRatioChange(value)}
            framed={false}
            className="grid w-full grid-cols-3 gap-2"
            highlightClassName="bg-transparent"
          >
            {ASPECT_RATIO_PRESETS.map((preset) => {
              const previewRatio =
                preset.width && preset.height
                  ? preset.width / preset.height
                  : recordingResult
                    ? sourceWidth / sourceHeight
                    : 16 / 9;

              return (
                <ToggleGroupItem
                  key={preset.id}
                  value={preset.id}
                  disabled={!recordingResult}
                  className={cn(
                    'group h-auto min-h-[60px] max-h-[80px] w-full flex-col items-center justify-center rounded-md border border-sf-border bg-sf-panel p-3 text-center shadow-none transition-all',
                    aspectRatioId === preset.id
                      ? 'border-sf-border-lt bg-[#151519] text-sf-primary ring-1 ring-sf-border-lt'
                      : 'bg-[#0d0d10] text-sf-secondary opacity-65 hover:border-sf-border-lt hover:text-sf-primary hover:opacity-85',
                    !recordingResult && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <div className="relative mb-1 flex h-12 w-full items-center justify-center overflow-hidden rounded bg-[#111318]">
                    <div
                      className="relative z-10 max-h-7 overflow-hidden rounded-sm border border-white/45 bg-white/10"
                      style={{
                        aspectRatio: `${previewRatio}`,
                        width: previewRatio >= 1 ? '70%' : `${Math.max(26, previewRatio * 48)}px`,
                        height: previewRatio >= 1 ? `${Math.max(18, 48 / previewRatio)}px` : '70%',
                      }}
                    >
                      <div
                        className="pointer-events-none absolute inset-0 opacity-90"
                        style={{
                          backgroundImage:
                            'repeating-linear-gradient(135deg, transparent 0 3px, rgba(255,255,255,0.12) 3px 4px, transparent 4px 7px)',
                        }}
                      />
                      <div className="pointer-events-none absolute inset-x-2 top-1/2 h-4 -translate-y-1/2 rounded-full bg-white/8 blur-md" />
                    </div>
                  </div>
                  <div className="text-md font-medium leading-none">{preset.label}</div>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </section> */}

        <section className="flex flex-col gap-4">
          <div>
            <div className={WIDGET_SECTION_HEADING_CLASS}>{t('background')}</div>
          </div>

          <ToggleGroup
            type="single"
            size="sm"
            value={type}
            onValueChange={(value) => {
              if (value) {
                patchBackground('Change background type', { type: value as BackgroundType });
                trackFrame('background_type', value);
              }
            }}
            className="w-full"
          >
            {BG_TAB_VALUES.map((tabValue) => (
              <ToggleGroupItem key={tabValue} value={tabValue} className="flex-1 text-md">
                {t(tabValue as 'wallpaper' | 'solid')}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {type === 'wallpaper' && (
            <div className="grid w-full grid-cols-5 gap-1.5">
              {WALLPAPER_PRESETS.map((preset, index) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.label}
                  className={cn(
                    'group h-auto cursor-pointer overflow-hidden rounded-md border p-0 shadow-none transition-all active:scale-[0.95]',
                    wallpaperSeed === index
                      ? 'border-sf-border-lt bg-[#151519] ring-1 ring-sf-border-lt'
                      : 'border-[#262629] bg-[#0d0d10] opacity-65 hover:border-sf-border-lt hover:opacity-85',
                  )}
                  style={{ aspectRatio: '1' }}
                  onClick={() => {
                    patchBackground('Change wallpaper', { wallpaperSeed: index });
                    trackFrame('wallpaper_seed', index);
                  }}
                >
                  <img
                    src={preset.url}
                    alt={preset.label}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </button>
              ))}

              {/* Custom image tile — only rendered after user picks an image */}
              {customWallpaperPreview && (
                <button
                  type="button"
                  title="Custom wallpaper"
                  className={cn(
                    'group h-auto cursor-pointer overflow-hidden rounded-md border p-0 shadow-none transition-all active:scale-[0.95]',
                    isCustomSelected
                      ? 'border-sf-border-lt bg-[#151519] ring-1 ring-sf-border-lt'
                      : 'border-[#262629] bg-[#0d0d10] opacity-65 hover:border-sf-border-lt hover:opacity-85',
                  )}
                  style={{ aspectRatio: '1' }}
                  onClick={() => {
                    patchBackground('Change wallpaper', { wallpaperSeed: CUSTOM_WALLPAPER_SEED });
                    trackFrame('wallpaper_seed', CUSTOM_WALLPAPER_SEED);
                  }}
                >
                  <img
                    src={customWallpaperPreview}
                    alt="Custom"
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                </button>
              )}

              {/* "+" slot — always last, opens file picker */}
              <button
                type="button"
                title="Upload custom wallpaper"
                className="group relative h-auto cursor-pointer overflow-hidden rounded-md border border-dashed border-[#484850] bg-[#0d0d10] p-0 opacity-70 shadow-none transition-[border-color,opacity,transform] duration-150 hover:border-[#606068] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sf-border-lt active:scale-[0.95]"
                style={{ aspectRatio: '1' }}
                onClick={() => customWallpaperInputRef.current?.click()}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <IconPlus
                    size={18}
                    className="text-[#606068] transition-colors duration-150 group-hover:text-sf-secondary"
                  />
                </div>
              </button>

              <input
                ref={customWallpaperInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleCustomWallpaperPick}
              />
            </div>
          )}

          {type === 'gradient' && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-4 gap-1.5">
                {GRADIENT_PRESETS.map((preset) => {
                  const background = `linear-gradient(${preset.angle}deg, ${preset.stops.map((stop) => `${stop.color} ${stop.offset * 100}%`).join(', ')})`;

                  return (
                    <Button
                      key={preset.id}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePresetClick(preset.id)}
                      title={preset.label}
                      className={cn(
                        'h-auto border-2 p-0 shadow-none hover:bg-transparent',
                        gradientPresetId === preset.id
                          ? 'border-sf-border-lt'
                          : 'border-transparent hover:border-sf-border-lt',
                      )}
                      style={{ background, aspectRatio: '1', borderRadius: 6 }}
                    >
                      <span className="sr-only">{preset.label}</span>
                    </Button>
                  );
                })}
              </div>

              <div className="flex items-center gap-3">
                <div className="flex flex-1 items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => fromInputRef.current?.click()}
                    className="h-7 w-7 shrink-0 rounded border border-sf-border p-0 shadow-none transition-colors hover:border-sf-border-lt hover:bg-transparent"
                    style={{ background: gradientFrom }}
                    title={t('startColor')}
                  />
                  <input
                    ref={fromInputRef}
                    type="color"
                    value={gradientFrom}
                    onChange={(event) =>
                      patchBackground('Change gradient start color', {
                        gradientFrom: event.target.value,
                        gradientPresetId: 'custom',
                      })
                    }
                    className="sr-only"
                  />
                  <span className="text-xs font-medium text-sf-secondary">{t('from')}</span>
                </div>

                <div className="flex flex-1 items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => toInputRef.current?.click()}
                    className="h-7 w-7 shrink-0 rounded border border-sf-border p-0 shadow-none transition-colors hover:border-sf-border-lt hover:bg-transparent"
                    style={{ background: gradientTo }}
                    title={t('endColor')}
                  />
                  <input
                    ref={toInputRef}
                    type="color"
                    value={gradientTo}
                    onChange={(event) =>
                      patchBackground('Change gradient end color', {
                        gradientTo: event.target.value,
                        gradientPresetId: 'custom',
                      })
                    }
                    className="sr-only"
                  />
                  <span className="text-xs font-medium text-sf-secondary">{t('to')}</span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Slider
                  min={0}
                  max={360}
                  step={15}
                  inlineLabel={t('direction')}
                  valueLabel={`${gradientAngle}°`}
                  value={[gradientAngle]}
                  onPointerDown={() =>
                    beginHistoryGroup('frame-gradient-angle', 'Adjust gradient angle')
                  }
                  onValueChange={([value]) =>
                    patchBackground('Adjust gradient angle', {
                      gradientAngle: value,
                      gradientPresetId: 'custom',
                    })
                  }
                  onValueCommit={() => endHistoryGroup('frame-gradient-angle')}
                />
                <div className="mt-0.5 flex gap-1">
                  {ANGLE_PRESETS.map((preset) => (
                    <Button
                      key={preset.value}
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() =>
                        patchBackground('Set gradient angle preset', {
                          gradientAngle: preset.value,
                          gradientPresetId: 'custom',
                        })
                      }
                      className={cn(
                        'flex-1 rounded border px-0 py-1 text-md shadow-none hover:bg-transparent',
                        gradientAngle === preset.value
                          ? 'border-sf-border-lt text-sf-primary'
                          : 'border-sf-border text-sf-muted hover:border-sf-border-lt hover:text-sf-secondary',
                      )}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {type === 'solid' && (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => solidInputRef.current?.click()}
                className="h-12 w-12 rounded-md border border-sf-border p-0 shadow-none transition-colors hover:border-sf-border-lt hover:bg-transparent"
                style={{ background: solidColor }}
                title={t('pickColor')}
              />
              <input
                ref={solidInputRef}
                type="color"
                value={solidColor}
                onChange={(event) =>
                  patchBackground('Change solid background color', {
                    solidColor: event.target.value,
                  })
                }
                className="sr-only"
              />
            </div>
          )}

          <div className="flex flex-col gap-4 border-t border-[#161515] pt-4">
            <div className={WIDGET_SECTION_HEADING_CLASS}>{t('frame')}</div>

            <div className="flex flex-col gap-1.5">
              <Slider
                min={0}
                max={40}
                step={1}
                inlineLabel={t('padding')}
                valueLabel={`${Math.round(padding * 100)}%`}
                value={[Math.round(padding * 100)]}
                onPointerDown={() => beginHistoryGroup('frame-padding', 'Adjust frame padding')}
                onValueChange={([value]) =>
                  patchBackground('Adjust frame padding', { padding: value / 100 })
                }
                onValueCommit={([value]) => {
                  endHistoryGroup('frame-padding');
                  trackFrame('padding_percent', value);
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Slider
                min={0}
                max={40}
                step={1}
                inlineLabel={t('cornerRadius')}
                valueLabel={`${cornerRadius}px`}
                value={[cornerRadius]}
                onPointerDown={() =>
                  beginHistoryGroup('frame-corner-radius', 'Adjust corner radius')
                }
                onValueChange={([value]) =>
                  patchBackground('Adjust corner radius', { cornerRadius: value })
                }
                onValueCommit={([value]) => {
                  endHistoryGroup('frame-corner-radius');
                  trackFrame('corner_radius_px', value);
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-[#161515] pt-4">
            <div className="flex items-center justify-between">
              <div className={WIDGET_SECTION_HEADING_CLASS}>{t('crop')}</div>
              {!isCropEditing && isCropApplied && (
                <span className="text-xs font-medium text-sf-secondary">{t('applied')}</span>
              )}
            </div>

            {isCropEditing ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    commitFrameEdit('Reset crop', (state) => ({
                      frame: { ...state.frame, cropRect: { x: 0, y: 0, width: 1, height: 1 } },
                    }));
                  }}
                >
                  {t('reset')}
                </Button>
                <Button size="sm" className="flex-1" onClick={() => setIsCropEditing(false)}>
                  {t('done')}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={!recordingResult}
                className="w-full"
                onClick={() => {
                  requestPauseAndSeekTo(getInitialPlaybackTime(mediaSegments));
                  waitingForPauseToOpenCropRef.current = true;
                }}
              >
                {t('editCrop')}
              </Button>
            )}
          </div>

          <div className="flex flex-col gap-4 border-t border-[#161515] pt-4">
            <div className={WIDGET_SECTION_HEADING_CLASS}>{t('shadow')}</div>

            <div className="flex flex-col gap-1.5">
              <Slider
                min={0}
                max={80}
                step={1}
                inlineLabel={t('blur')}
                valueLabel={`${shadowBlur}px`}
                value={[shadowBlur]}
                onPointerDown={() => beginHistoryGroup('frame-shadow-blur', 'Adjust shadow blur')}
                onValueChange={([value]) =>
                  patchBackground('Adjust shadow blur', { shadowBlur: value })
                }
                onValueCommit={([value]) => {
                  endHistoryGroup('frame-shadow-blur');
                  trackFrame('shadow_blur_px', value);
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Slider
                min={0}
                max={100}
                step={1}
                inlineLabel={t('opacity')}
                valueLabel={`${Math.round(shadowOpacity * 100)}%`}
                value={[Math.round(shadowOpacity * 100)]}
                onPointerDown={() =>
                  beginHistoryGroup('frame-shadow-opacity', 'Adjust shadow opacity')
                }
                onValueChange={([value]) =>
                  patchBackground('Adjust shadow opacity', { shadowOpacity: value / 100 })
                }
                onValueCommit={([value]) => {
                  endHistoryGroup('frame-shadow-opacity');
                  trackFrame('shadow_opacity_percent', value);
                }}
              />
            </div>
          </div>

          <LogoSection />
        </section>
      </div>
    </div>
  );
};
