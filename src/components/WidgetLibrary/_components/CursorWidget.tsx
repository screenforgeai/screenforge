import { motion } from 'motion/react';
import { useCallback, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { trackEvent } from 'src/lib/analytics';
import { useShallow } from 'zustand/react/shallow';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '../../../lib/ui';
import { useStore } from '../../../store';
import type { CursorClickEffect, CursorClickSound } from '../../../store';
import { CLICK_SOUND_OPTIONS, auditionCursorClickSound } from '../../../lib/effects/cursor/audio';
import { CURSOR_PREVIEW_STATES, CURSOR_REGISTRY } from '../../../lib/effects/cursor/cursors';
import type { CursorStyle } from '../../../lib/effects/cursor/cursors';
import { IconPointer, IconInfo, IconPlayerPlayFilled } from 'src/lib/icons';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { WidgetEnabledGate } from './WidgetEnabledGate';

const EASING_PRESETS = [
  { label: 'Default', value: 0.06 },
  { label: 'Instant', value: 0.01 },
] as const;

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

/* ── Widget ───────────────────────────────────────────────────────────────── */
export const CursorWidget = () => {
  const { t } = useTranslation('cursor');
  const [hoveredStyle, setHoveredStyle] = useState<CursorStyle | null>(null);
  // True while the click sound list is being moved through with the keyboard,
  // so each option reached plays as a preview. Mouse movement turns it off:
  // hovering an option stays silent and its play button is used instead.
  const isKeyboardBrowsingSoundsRef = useRef(false);

  const {
    recordingResult,
    cursorEnabled,
    cursorStyle,
    cursorClickEffect,
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
      cursorEnabled: state.cursorEnabled,
      cursorStyle: state.cursorStyle,
      cursorClickEffect: state.cursorClickEffect,
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

  const updateCursor = useCallback(
    (label: string, patch: Record<string, unknown>) => {
      commitEdit(label, () => patch);
    },
    [commitEdit],
  );

  const trackCursor = (property: string, value: unknown) =>
    trackEvent('widget_config_changed', { widget: 'cursor', property, value });

  const selectedStyle: CursorStyle =
    cursorStyle in CURSOR_REGISTRY ? (cursorStyle as CursorStyle) : 'cursor01';

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
    <div className="flex h-full min-h-0 flex-col">
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
            <ToggleGroup
              type="single"
              value={selectedStyle}
              onValueChange={(v) => {
                if (v) {
                  updateCursor('Change cursor style', { cursorStyle: v as CursorStyle });
                  trackCursor('style', v);
                }
              }}
              framed={false}
              className="grid grid-cols-3 gap-1.5 w-fit"
              highlightClassName="bg-transparent"
            >
              {(
                Object.entries(CURSOR_REGISTRY) as [
                  CursorStyle,
                  (typeof CURSOR_REGISTRY)[CursorStyle],
                ][]
              ).map(([id, { states }]) => (
                <ToggleGroupItem
                  key={id}
                  value={id}
                  onMouseEnter={() => {
                    setHoveredStyle(id);
                  }}
                  onMouseLeave={() => {
                    setHoveredStyle((current) => (current === id ? null : current));
                  }}
                  className={`group relative min-h-14 max-h-14 min-w-14 max-w-14 min-w-14 p-0 rounded-lg border overflow-hidden transition-all ${
                    selectedStyle === id
                      ? 'border-sf-border-lt bg-[#151519] ring-1 ring-sf-border-lt'
                      : 'border-[#262629] bg-[#0d0d10] opacity-65 hover:opacity-85'
                  }`}
                >
                  <div
                    className={`relative size-14 flex justify-center items-center transition-opacity ${
                      selectedStyle === id ? 'bg-[#151519] opacity-100' : 'bg-[#0d0d10] opacity-45'
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
                          <Preview className="size-7 text-white" />
                        </motion.div>
                      );
                    })}
                  </div>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {/* Visibility */}
          <div className="flex flex-col gap-2.5 py-4">
            <span className={WIDGET_SECTION_HEADING_CLASS}>{t('visibility')}</span>
            <ToggleGroup
              type="single"
              size="sm"
              value={cursorHideWhenIdle ? 'idle' : 'always'}
              onValueChange={(v) => {
                if (v) {
                  updateCursor('Change cursor visibility', {
                    cursorHideWhenIdle: v === 'idle',
                  });
                  trackCursor('hide_when_idle', v === 'idle');
                }
              }}
              className="w-full"
            >
              <ToggleGroupItem value="always" className="flex-1 text-md">
                {t('always')}
              </ToggleGroupItem>
              <ToggleGroupItem value="idle" className="flex-1 text-md">
                {t('hideWhenIdle')}
              </ToggleGroupItem>
            </ToggleGroup>

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

          {/* Motion Blur */}
          <div className="flex flex-col gap-2.5 py-4">
            <span className={WIDGET_SECTION_HEADING_CLASS}>{t('motionBlur')}</span>
            <ToggleGroup
              type="single"
              size="sm"
              value={cursorMotionBlur ? 'on' : 'off'}
              onValueChange={(v) => {
                if (v) {
                  updateCursor('Toggle cursor motion blur', { cursorMotionBlur: v === 'on' });
                  trackCursor('motion_blur', v === 'on');
                }
              }}
              className="w-full"
            >
              <ToggleGroupItem value="on" className="flex-1 text-md">
                {t('on')}
              </ToggleGroupItem>
              <ToggleGroupItem value="off" className="flex-1 text-md">
                {t('off')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Click Effect */}
          <div className="flex flex-col gap-2.5 py-4">
            <span className={WIDGET_SECTION_HEADING_CLASS}>{t('clickEffect')}</span>
            <ToggleGroup
              type="single"
              size="sm"
              value={cursorClickEffect}
              onValueChange={(v) => {
                if (v) {
                  updateCursor('Change cursor click effect', {
                    cursorClickEffect: v as CursorClickEffect,
                  });
                  trackCursor('click_effect', v);
                }
              }}
              className="w-full"
            >
              <ToggleGroupItem value="ripple" className="flex-1 text-md">
                {t('ripple')}
              </ToggleGroupItem>
              <ToggleGroupItem value="none" className="flex-1 text-md">
                {t('none')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Click Sound */}
          <div className="flex flex-col gap-2.5 py-4">
            <span className={WIDGET_SECTION_HEADING_CLASS}>{t('clickSound')}</span>
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

          {/* Camera Follow */}
          <div className="flex flex-col gap-2.5 py-4">
            <div className="flex items-center gap-1.5">
              <span className={WIDGET_SECTION_HEADING_CLASS}>{t('cameraFollow')}</span>
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

          {/* Cursor Size + Rotation */}
          <div className="flex flex-col gap-3 py-4">
            <span className="text-md text-sf-primary tracking-wider">{t('dimensions')}</span>

            <div className="flex flex-col gap-2.5">
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

            <div className="flex flex-col gap-2.5">
              <Slider
                min={0}
                max={20}
                step={1}
                inlineLabel={t('rotation')}
                valueLabel={`${clampValue(cursorMaxTilt, 0, 20)}°`}
                value={[clampValue(cursorMaxTilt, 0, 20)]}
                onPointerDown={() => beginHistoryGroup('cursor-rotation', 'Adjust cursor rotation')}
                onValueChange={([v]) =>
                  updateCursor('Adjust cursor rotation', { cursorMaxTilt: v })
                }
                onValueCommit={([v]) => {
                  endHistoryGroup('cursor-rotation');
                  trackCursor('rotation_deg', v);
                }}
              />
            </div>
          </div>

          {/* Cursor Easing */}
          <div className="flex flex-col gap-2.5 pt-4">
            <span className="text-md text-sf-primary tracking-wider">{t('easing')}</span>
            <ToggleGroup
              type="single"
              size="sm"
              value={String(cursorHalflife)}
              onValueChange={(v) => {
                if (v) {
                  updateCursor('Change cursor easing', { cursorHalflife: Number(v) });
                  const label = EASING_PRESETS.find((p) => String(p.value) === v)?.label ?? v;
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
      </WidgetEnabledGate>
    </div>
  );
};
