import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { trackEvent } from 'src/lib/analytics';
import { useShallow } from 'zustand/react/shallow';
import {
  Input,
  PreviewCardBody,
  PreviewCardProvider,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  SwitchThumb,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  usePreviewCard,
} from '../../../lib/ui';
import { useStore } from '../../../store';
import type { CursorClickEffect, CursorClickSound, CursorEffect } from '../../../store';
import { CLICK_SOUND_OPTIONS, auditionCursorClickSound } from '../../../lib/effects/cursor/audio';
import { CURSOR_PREVIEW_STATES, CURSOR_REGISTRY } from '../../../lib/effects/cursor/cursors';
import {
  CURSOR_COLOR_OPTIONS,
  CURSOR_LABEL_MAX_LENGTH,
  CURSOR_STYLE_GROUPS,
  isNameTagCursorStyle,
  normalizeCursorLabel,
  normalizeCursorStyle,
  type CursorStyleId,
} from '../../../lib/effects/cursor/styles';
import { IconChevronDown, IconPointer, IconInfo, IconPlayerPlayFilled } from 'src/lib/icons';
import { cn } from 'src/lib/utils';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { WidgetEnabledGate } from './WidgetEnabledGate';
import { CursorPreviewStage } from './CursorPreviewStage';
import type { CursorPreviewSettings } from './CursorPreviewStage';
import { useRecordingFrame } from './MotionWidget/useRecordingFrame';

const EASING_PRESETS = [
  { label: 'Default', value: 0.06 },
  { label: 'Instant', value: 0.01 },
] as const;

/** Click effects, everyday ones first; the playful ones sit under their own heading. */
const CLICK_EFFECT_GROUPS: { id: 'basic' | 'playful'; options: CursorClickEffect[] }[] = [
  { id: 'basic', options: ['none', 'ripple', 'pulse'] },
  { id: 'playful', options: ['sparkle', 'confetti'] },
];

const CURSOR_EFFECT_GROUPS: { id: 'basic' | 'playful'; options: CursorEffect[] }[] = [
  { id: 'basic', options: ['none', 'highlight', 'spotlight', 'magnifier'] },
  { id: 'playful', options: ['glitter'] },
];

const COLOR_NAMES: Record<string, string> = {
  '#1D9BF0': 'sky',
  '#2F6FED': 'blue',
  '#7C5CFF': 'violet',
  '#16A34A': 'green',
  '#F2552C': 'orange',
  '#E5484D': 'red',
  '#111114': 'black',
};

const clampValue = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Preview button inside a dropdown option. It stops pointer and click events so
 * the Select neither picks the option nor closes; you can audition several in a row.
 */
const ClickSoundPlayButton = ({ label, onPlay }: { label: string; onPlay: () => void }) => {
  const stop = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        onPlay();
      }}
      className="flex size-6 items-center justify-center rounded-full text-sf-secondary transition-colors hover:bg-sf-border-lt hover:text-sf-primary"
    >
      <IconPlayerPlayFilled size={11} />
    </button>
  );
};

const PREVIEW_STATE_DURATION = 0.7;
const PREVIEW_LOOP_DURATION = PREVIEW_STATE_DURATION * CURSOR_PREVIEW_STATES.length;
const PREVIEW_HOVER_ORDER = [...CURSOR_PREVIEW_STATES.slice(1), CURSOR_PREVIEW_STATES[0]];
const PREVIEW_STEP_EPSILON = 0.0001;
const PREVIEW_SEGMENT = 1 / CURSOR_PREVIEW_STATES.length;
const PREVIEW_STEP_TIMES: number[] = [0];
for (let i = 0; i < CURSOR_PREVIEW_STATES.length; i++) {
  const segmentStart = i * PREVIEW_SEGMENT;
  const segmentEnd = (i + 1) * PREVIEW_SEGMENT;
  PREVIEW_STEP_TIMES.push(
    segmentEnd < 1
      ? Math.max(segmentEnd - PREVIEW_STEP_EPSILON, segmentStart)
      : 1 - PREVIEW_STEP_EPSILON,
  );
  PREVIEW_STEP_TIMES.push(segmentEnd);
}

const PREVIEW_LOOP_KEYFRAMES = CURSOR_PREVIEW_STATES.map((_, stateIndex) => {
  const values: number[] = [PREVIEW_HOVER_ORDER[0] === CURSOR_PREVIEW_STATES[stateIndex] ? 1 : 0];
  for (let i = 0; i < PREVIEW_HOVER_ORDER.length; i++) {
    const nextStateIndex = i === PREVIEW_HOVER_ORDER.length - 1 ? 0 : i + 1;
    values.push(PREVIEW_HOVER_ORDER[i] === CURSOR_PREVIEW_STATES[stateIndex] ? 1 : 0);
    values.push(PREVIEW_HOVER_ORDER[nextStateIndex] === CURSOR_PREVIEW_STATES[stateIndex] ? 1 : 0);
  }
  return values;
});

/**
 * The style picker: one grid of tiles, standard styles first, then modern and
 * decorative. Hovering a tile cycles its arrow, hand and text cursor and opens
 * the preview card.
 */
const CursorStyleGrid = ({
  selected,
  color,
  onSelect,
  preview,
}: {
  selected: CursorStyleId;
  /** The name-tag colour, shown on the Collaborator and Rounded tiles. */
  color: string;
  onSelect: (style: CursorStyleId) => void;
  preview: (style: CursorStyleId) => ReturnType<ReturnType<typeof usePreviewCard>['bind']>;
}) => {
  const { t } = useTranslation('cursor');
  const [hoveredStyle, setHoveredStyle] = useState<CursorStyleId | null>(null);
  return (
    <ToggleGroup
      type="single"
      value={selected}
      onValueChange={(v) => {
        if (v) {
          onSelect(v as CursorStyleId);
        }
      }}
      framed={false}
      className="grid w-full grid-cols-6 gap-1.5"
      highlightClassName="bg-transparent"
    >
      {CURSOR_STYLE_GROUPS.flatMap((group) => group.styles).map((id) => {
        const { states } = CURSOR_REGISTRY[id];
        const bind = preview(id);
        return (
          <ToggleGroupItem
            key={id}
            value={id}
            aria-label={t(`style_${id}`)}
            {...bind}
            onPointerEnter={(event) => {
              setHoveredStyle(id);
              bind.onPointerEnter(event);
            }}
            onPointerLeave={() => {
              setHoveredStyle((current) => (current === id ? null : current));
              bind.onPointerLeave();
            }}
            className={`group relative aspect-square h-auto w-full min-w-0 p-0 rounded-lg border overflow-hidden transition-all ${
              selected === id
                ? 'border-sf-border-lt bg-[#151519] ring-1 ring-sf-border-lt'
                : 'border-[#262629] bg-[#0d0d10] hover:border-sf-border-lt'
            }`}
          >
            <div
              className={`relative size-full flex justify-center items-center transition-opacity ${
                selected === id
                  ? 'bg-[#151519] opacity-100'
                  : 'bg-[#0d0d10] opacity-75 group-hover:opacity-100'
              }`}
            >
              {CURSOR_PREVIEW_STATES.map((state, index) => {
                const Preview = states[state].Preview;
                const isHovered = hoveredStyle === id;
                const restingOpacity = index === 0 ? 1 : 0;
                return (
                  <motion.div
                    key={state}
                    className="absolute inset-0 flex items-center justify-center"
                    initial={false}
                    animate={{
                      opacity: isHovered ? PREVIEW_LOOP_KEYFRAMES[index] : restingOpacity,
                    }}
                    transition={
                      isHovered
                        ? {
                            duration: PREVIEW_LOOP_DURATION,
                            ease: 'linear',
                            times: PREVIEW_STEP_TIMES,
                            repeat: Infinity,
                            repeatType: 'loop',
                          }
                        : { duration: 0 }
                    }
                  >
                    <Preview className="size-6 text-white" color={color} />
                  </motion.div>
                );
              })}
            </div>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
};

/** One on/off setting: name and a short note on the left, a switch on the right. */
const SettingRow = ({
  label,
  description,
  checked,
  onCheckedChange,
  switchProps,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  switchProps?: Record<string, unknown>;
}) => (
  <div className="flex items-start justify-between gap-3">
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-md text-sf-primary">{label}</span>
      {description ? (
        <span className="text-sm leading-snug text-sf-secondary/75">{description}</span>
      ) : null}
    </div>
    <Switch
      size="xs"
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className="mt-0.5"
      {...switchProps}
    >
      <SwitchThumb />
    </Switch>
  </div>
);

/* ── Widget ───────────────────────────────────────────────────────────────── */
export const CursorWidget = () => (
  <PreviewCardProvider>
    <CursorWidgetBody />
  </PreviewCardProvider>
);

const CursorWidgetBody = () => {
  const { t } = useTranslation('cursor');
  const preview = usePreviewCard();
  // True while the click sound list is being moved through with the keyboard,
  // so each option reached plays as a preview. Mouse movement turns it off:
  // hovering an option stays silent and its play button is used instead.
  const isKeyboardBrowsingSoundsRef = useRef(false);
  // Fine-tuning lives under Advanced, closed by default like Zoom's.
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const {
    recordingResult,
    background,
    cursorEnabled,
    cursorStyle,
    cursorClickEffect,
    cursorEffect,
    cursorClickShrink,
    cursorColor,
    cursorLabel,
    cursorSize,
    cursorHalflife,
    cursorMotionBlur,
    cursorMaxTilt,
    cursorHideWhenIdle,
    cursorIdleHideSeconds,
    cursorContinuousTracking,
    cursorClickSound,
    cursorClickSoundVolume,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
  } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      background: state.frame.background,
      cursorEnabled: state.cursorEnabled,
      cursorStyle: state.cursorStyle,
      cursorClickEffect: state.cursorClickEffect,
      cursorEffect: state.cursorEffect,
      cursorClickShrink: state.cursorClickShrink,
      cursorColor: state.cursorColor,
      cursorLabel: state.cursorLabel,
      cursorSize: state.cursorSize,
      cursorHalflife: state.cursorHalflife,
      cursorMotionBlur: state.cursorMotionBlur,
      cursorMaxTilt: state.cursorMaxTilt,
      cursorHideWhenIdle: state.cursorHideWhenIdle,
      cursorIdleHideSeconds: state.cursorIdleHideSeconds,
      cursorContinuousTracking: state.cursorContinuousTracking,
      cursorClickSound: state.cursorClickSound,
      cursorClickSoundVolume: state.cursorClickSoundVolume,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
    })),
  );

  // One still of the user's own recording, decoded once, shared by every preview.
  const still = useRecordingFrame(
    recordingResult?.filePath ?? null,
    Math.round((recordingResult?.duration ?? 0) * 0.5 * 2) / 2,
  );

  const updateCursor = useCallback(
    (label: string, patch: Record<string, unknown>) => {
      commitEdit(label, () => patch);
    },
    [commitEdit],
  );

  const trackCursor = (property: string, value: unknown) =>
    trackEvent('widget_config_changed', { widget: 'cursor', property, value });

  const selectedStyle = normalizeCursorStyle(cursorStyle);
  const current: CursorPreviewSettings = {
    style: selectedStyle,
    clickEffect: cursorClickEffect,
    cursorEffect,
    clickShrink: cursorClickShrink,
    color: cursorColor,
    label: cursorLabel,
  };

  /** Hover card for an option: the cursor with that one setting changed. */
  const bindPreview = (
    id: string,
    change: Partial<CursorPreviewSettings>,
    title: string,
    description: string,
    isCurrent: boolean,
  ) =>
    preview.bind(id, () => (
      <PreviewCardBody
        preview={
          <CursorPreviewStage
            settings={{ ...current, ...change }}
            frame={still}
            background={background}
          />
        }
        title={title}
        description={description}
        badge={isCurrent ? t('current') : undefined}
      />
    ));

  const groupHeading = (index: number, label: ReactNode) => (
    <>
      {index > 0 && <SelectSeparator />}
      {label !== null && <SelectLabel>{label}</SelectLabel>}
    </>
  );

  if (!recordingResult) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={WIDGET_PANEL_HEADER_CLASS}>
          <IconPointer className="size-4.5" />
          {t('header')}
        </div>

        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconPointer size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-preview-boundary>
      <WidgetEnabledGate
        title={t('header')}
        icon={<IconPointer className="size-4.5" />}
        enabled={cursorEnabled}
        onToggle={(checked) => {
          updateCursor('Toggle cursor', { cursorEnabled: checked });
          trackCursor('enabled', checked);
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-[#161515] overflow-y-auto px-4 pb-6">
          {/* Cursor Style */}
          <div className="flex flex-col gap-2.5 pb-4">
            <span className={WIDGET_SECTION_HEADING_CLASS}>{t('style')}</span>
            <CursorStyleGrid
              selected={selectedStyle}
              color={cursorColor}
              onSelect={(style) => {
                updateCursor('Change cursor style', { cursorStyle: style });
                trackCursor('style', style);
              }}
              preview={(style) =>
                bindPreview(
                  `style-${style}`,
                  { style },
                  t(`style_${style}`),
                  t(`styleDesc_${style}`),
                  style === selectedStyle,
                )
              }
            />

            {isNameTagCursorStyle(selectedStyle) ? (
              <div className="flex flex-col gap-2.5 pt-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-md text-sf-secondary">{t('name')}</span>
                  <Input
                    value={cursorLabel}
                    maxLength={CURSOR_LABEL_MAX_LENGTH}
                    placeholder={t('namePlaceholder')}
                    aria-label={t('name')}
                    className="h-8 w-36"
                    onFocus={() => beginHistoryGroup('cursor-label', 'Edit cursor name')}
                    // Keep what's typed (spaces included) and trim once the field is left.
                    onChange={(event) =>
                      updateCursor('Edit cursor name', {
                        cursorLabel: event.target.value.slice(0, CURSOR_LABEL_MAX_LENGTH),
                      })
                    }
                    onBlur={() => {
                      const trimmed = normalizeCursorLabel(cursorLabel);
                      if (trimmed !== cursorLabel) {
                        updateCursor('Edit cursor name', { cursorLabel: trimmed });
                      }
                      endHistoryGroup('cursor-label');
                      trackCursor('label_length', trimmed.length);
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-md text-sf-secondary">{t('color')}</span>
                  <div
                    className="flex items-center gap-1.5"
                    role="radiogroup"
                    aria-label={t('color')}
                  >
                    {CURSOR_COLOR_OPTIONS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        role="radio"
                        aria-checked={color === cursorColor}
                        aria-label={t(`colorName_${COLOR_NAMES[color]}`)}
                        title={t(`colorName_${COLOR_NAMES[color]}`)}
                        onClick={() => {
                          updateCursor('Change cursor color', { cursorColor: color });
                          trackCursor('color', COLOR_NAMES[color]);
                        }}
                        className={cn(
                          'size-5 rounded-full border-2 transition-[border-color,transform] duration-150 hover:scale-110',
                          color === cursorColor ? 'border-sf-primary' : 'border-transparent',
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="pt-1">
              <Slider
                min={50}
                max={500}
                step={5}
                inlineLabel={t('size')}
                valueLabel={`${clampValue(cursorSize, 50, 500)}%`}
                value={[clampValue(cursorSize, 50, 500)]}
                onPointerDown={() => beginHistoryGroup('cursor-size', 'Adjust cursor size')}
                onValueChange={([v]) => updateCursor('Adjust cursor size', { cursorSize: v })}
                onValueCommit={([v]) => {
                  endHistoryGroup('cursor-size');
                  trackCursor('size_percent', v);
                }}
              />
            </div>
          </div>

          {/* Clicks */}
          <div className="flex flex-col gap-3 py-4">
            <span className={WIDGET_SECTION_HEADING_CLASS}>{t('clicks')}</span>
            <div className="flex flex-col gap-2">
              <span className="text-sm text-sf-secondary">{t('effect')}</span>
              <Select
                value={cursorClickEffect}
                onValueChange={(v) => {
                  updateCursor('Change cursor click effect', {
                    cursorClickEffect: v as CursorClickEffect,
                  });
                  trackCursor('click_effect', v);
                }}
              >
                <SelectTrigger aria-label={t('clickEffect')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLICK_EFFECT_GROUPS.map((group, i) => (
                    <SelectGroup key={group.id}>
                      {groupHeading(i, group.id === 'playful' ? t('group_playful') : null)}
                      {group.options.map((effect) => (
                        <SelectItem
                          key={effect}
                          value={effect}
                          {...bindPreview(
                            `click-${effect}`,
                            { clickEffect: effect },
                            t(`click_${effect}`),
                            t(`clickDesc_${effect}`),
                            effect === cursorClickEffect,
                          )}
                        >
                          {t(`click_${effect}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm text-sf-secondary">{t('sound')}</span>
              <Select
                value={cursorClickSound}
                onOpenChange={() => {
                  isKeyboardBrowsingSoundsRef.current = false;
                }}
                onValueChange={(v) => {
                  const sound = v as CursorClickSound;
                  updateCursor('Change click sound', { cursorClickSound: sound });
                  trackCursor('click_sound', sound);
                  void auditionCursorClickSound(sound, cursorClickSoundVolume);
                }}
              >
                <SelectTrigger aria-label={t('clickSound')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  onKeyDown={() => {
                    isKeyboardBrowsingSoundsRef.current = true;
                  }}
                  // Capture phase: Radix focuses an option in its own pointermove handler,
                  // so the flag must clear before that focus fires.
                  onPointerMoveCapture={() => {
                    isKeyboardBrowsingSoundsRef.current = false;
                  }}
                >
                  {CLICK_SOUND_OPTIONS.map((sound) => (
                    <SelectItem
                      key={sound}
                      value={sound}
                      onFocus={() => {
                        if (isKeyboardBrowsingSoundsRef.current) {
                          void auditionCursorClickSound(sound, cursorClickSoundVolume);
                        }
                      }}
                      endAdornment={
                        sound === 'none' ? null : (
                          <ClickSoundPlayButton
                            label={t('playSound', { sound: t(sound) })}
                            onPlay={() => {
                              void auditionCursorClickSound(sound, cursorClickSoundVolume);
                            }}
                          />
                        )
                      }
                    >
                      {t(sound)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {cursorClickSound !== 'none' ? (
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  inlineLabel={t('volume')}
                  valueLabel={`${Math.round(clampValue(cursorClickSoundVolume, 0, 1) * 100)}%`}
                  value={[Math.round(clampValue(cursorClickSoundVolume, 0, 1) * 100)]}
                  onPointerDown={() =>
                    beginHistoryGroup('cursor-click-volume', 'Adjust click volume')
                  }
                  onValueChange={([v]) =>
                    updateCursor('Adjust click volume', { cursorClickSoundVolume: v / 100 })
                  }
                  onValueCommit={([v]) => {
                    endHistoryGroup('cursor-click-volume');
                    trackCursor('click_sound_volume', v);
                    void auditionCursorClickSound(cursorClickSound, v / 100);
                  }}
                />
              ) : null}
            </div>
            <SettingRow
              label={t('shrinkOnClick')}
              description={t('shrinkOnClickDesc')}
              checked={cursorClickShrink}
              onCheckedChange={(checked) => {
                updateCursor('Toggle shrink on click', { cursorClickShrink: checked });
                trackCursor('click_shrink', checked);
              }}
              switchProps={preview.bind('click-shrink', () => (
                <PreviewCardBody
                  preview={
                    <CursorPreviewStage
                      settings={{ ...current, clickShrink: true }}
                      frame={still}
                      background={background}
                    />
                  }
                  title={t('shrinkOnClick')}
                  description={t('shrinkOnClickDesc')}
                />
              ))}
            />
          </div>

          {/* Cursor Effect */}
          <div className="flex flex-col gap-2.5 py-4">
            <span className={WIDGET_SECTION_HEADING_CLASS}>{t('cursorEffect')}</span>
            <Select
              value={cursorEffect}
              onValueChange={(v) => {
                updateCursor('Change cursor effect', { cursorEffect: v as CursorEffect });
                trackCursor('cursor_effect', v);
              }}
            >
              <SelectTrigger aria-label={t('cursorEffect')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURSOR_EFFECT_GROUPS.map((group, i) => (
                  <SelectGroup key={group.id}>
                    {groupHeading(i, group.id === 'playful' ? t('group_playful') : null)}
                    {group.options.map((effect) => (
                      <SelectItem
                        key={effect}
                        value={effect}
                        {...bindPreview(
                          `effect-${effect}`,
                          { cursorEffect: effect },
                          t(`effect_${effect}`),
                          t(`effectDesc_${effect}`),
                          effect === cursorEffect,
                        )}
                      >
                        {t(`effect_${effect}`)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Hide when idle */}
          <div className="flex flex-col gap-2.5 py-4">
            <SettingRow
              label={t('hideWhenIdle')}
              description={t('hideWhenIdleDesc')}
              checked={cursorHideWhenIdle}
              onCheckedChange={(checked) => {
                updateCursor('Change cursor visibility', { cursorHideWhenIdle: checked });
                trackCursor('hide_when_idle', checked);
              }}
            />
            {cursorHideWhenIdle ? (
              <div className="flex flex-col gap-2.5">
                <Slider
                  min={1}
                  max={10}
                  step={1}
                  inlineLabel={t('idleDelay')}
                  valueLabel={`${clampValue(cursorIdleHideSeconds, 1, 10)}s`}
                  value={[clampValue(cursorIdleHideSeconds, 1, 10)]}
                  onPointerDown={() =>
                    beginHistoryGroup('cursor-idle-delay', 'Adjust cursor idle delay')
                  }
                  onValueChange={([v]) =>
                    updateCursor('Adjust cursor idle delay', { cursorIdleHideSeconds: v })
                  }
                  onValueCommit={([v]) => {
                    endHistoryGroup('cursor-idle-delay');
                    trackCursor('idle_delay_seconds', v);
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* Advanced */}
          <div className="pt-3">
            <button
              type="button"
              aria-expanded={isAdvancedOpen}
              onClick={() => setIsAdvancedOpen((open) => !open)}
              className="flex min-h-8 w-full cursor-pointer items-center justify-between rounded-md px-0.5 text-left text-sm font-medium text-sf-secondary outline-none transition-colors duration-150 hover:text-sf-primary focus-visible:ring-2 focus-visible:ring-sf-border-lt"
            >
              <span>{t('advanced')}</span>
              <IconChevronDown
                aria-hidden
                size={14}
                stroke={1.5}
                className={cn(
                  'mr-0.5 transition-transform duration-200 ease-out',
                  isAdvancedOpen && 'rotate-180',
                )}
              />
            </button>
            <AnimatePresence initial={false}>
              {isAdvancedOpen && (
                <motion.div
                  key="advanced"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="flex flex-col gap-4 pt-2">
                    <Slider
                      min={0}
                      max={20}
                      step={1}
                      inlineLabel={t('rotation')}
                      valueLabel={`${clampValue(cursorMaxTilt, 0, 20)}°`}
                      value={[clampValue(cursorMaxTilt, 0, 20)]}
                      onPointerDown={() =>
                        beginHistoryGroup('cursor-rotation', 'Adjust cursor rotation')
                      }
                      onValueChange={([v]) =>
                        updateCursor('Adjust cursor rotation', { cursorMaxTilt: v })
                      }
                      onValueCommit={([v]) => {
                        endHistoryGroup('cursor-rotation');
                        trackCursor('rotation_deg', v);
                      }}
                    />

                    <SettingRow
                      label={t('motionBlur')}
                      description={t('motionBlurDesc')}
                      checked={cursorMotionBlur}
                      onCheckedChange={(checked) => {
                        updateCursor('Toggle cursor motion blur', { cursorMotionBlur: checked });
                        trackCursor('motion_blur', checked);
                      }}
                    />
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-sf-secondary">{t('cameraFollow')}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="flex items-center text-sf-muted hover:text-sf-secondary transition-colors"
                            >
                              <IconInfo size={14} />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-56 flex flex-col gap-1.5">
                            <span>{t('cameraFollowTooltipSmooth')}</span>
                            <span>{t('cameraFollowTooltipFixed')}</span>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <ToggleGroup
                        type="single"
                        size="sm"
                        value={cursorContinuousTracking ? 'smooth' : 'fixed'}
                        onValueChange={(v) => {
                          if (v) {
                            updateCursor('Change camera follow mode', {
                              cursorContinuousTracking: v === 'smooth',
                            });
                            trackCursor('continuous_tracking', v === 'smooth');
                          }
                        }}
                        className="w-full"
                      >
                        <ToggleGroupItem value="smooth" className="flex-1 text-md">
                          {t('cameraFollowSmooth')}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="fixed" className="flex-1 text-md">
                          {t('cameraFollowFixed')}
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    <div className="flex flex-col gap-2">
                      <span className="text-sm text-sf-secondary">{t('easing')}</span>
                      <ToggleGroup
                        type="single"
                        size="sm"
                        value={String(cursorHalflife)}
                        onValueChange={(v) => {
                          if (v) {
                            updateCursor('Change cursor easing', { cursorHalflife: Number(v) });
                            const label =
                              EASING_PRESETS.find((p) => String(p.value) === v)?.label ?? v;
                            trackCursor('easing', label);
                          }
                        }}
                        className="grid grid-cols-2 gap-1 w-full"
                        highlightClassName="bg-sf-border-lt rounded"
                      >
                        {EASING_PRESETS.map((p) => (
                          <ToggleGroupItem
                            key={p.label}
                            value={String(p.value)}
                            className="h-auto text-center py-1.5 rounded text-md text-sf-secondary hover:bg-transparent data-[state=on]:text-sf-primary data-[state=off]:bg-transparent"
                          >
                            {p.label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </WidgetEnabledGate>
    </div>
  );
};
