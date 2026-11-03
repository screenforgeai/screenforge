import { useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { trackEvent } from 'src/lib/analytics';
import { useShallow } from 'zustand/react/shallow';
import { Slider, ToggleGroup, ToggleGroupItem } from '../../../lib/ui';
import { useStore } from '../../../store';
import { IconVideo, IconVideoOff } from 'src/lib/icons';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { WidgetEnabledGate } from './WidgetEnabledGate';
import { findCameraClipAtTime } from 'src/lib/helpers/segments';
import type { CameraLayoutPreset } from 'src/types';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ── Layout icon SVGs ──────────────────────────────────────────────────────────

const PipIcon = () => (
  <svg width="36" height="24" viewBox="0 0 36 24" fill="none" aria-hidden="true">
    <rect
      x="0.5"
      y="0.5"
      width="35"
      height="23"
      rx="2.5"
      stroke="currentColor"
      strokeOpacity="0.3"
    />
    <rect x="22" y="13" width="11" height="8" rx="1.5" fill="currentColor" fillOpacity="0.85" />
  </svg>
);

const FullIcon = () => (
  <svg width="36" height="24" viewBox="0 0 36 24" fill="none" aria-hidden="true">
    <rect
      x="0.5"
      y="0.5"
      width="35"
      height="23"
      rx="2.5"
      fill="currentColor"
      fillOpacity="0.85"
      stroke="currentColor"
      strokeOpacity="0.3"
    />
  </svg>
);

const LeftIcon = () => (
  <svg width="36" height="24" viewBox="0 0 36 24" fill="none" aria-hidden="true">
    <rect
      x="0.5"
      y="0.5"
      width="35"
      height="23"
      rx="2.5"
      stroke="currentColor"
      strokeOpacity="0.3"
    />
    <rect x="0.5" y="0.5" width="14" height="23" rx="2.5" fill="currentColor" fillOpacity="0.85" />
    <line x1="3" y1="8" x2="13" y2="8" stroke="transparent" />
    <line
      x1="19"
      y1="7"
      x2="33"
      y2="7"
      stroke="currentColor"
      strokeOpacity="0.2"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <line
      x1="19"
      y1="11"
      x2="30"
      y2="11"
      stroke="currentColor"
      strokeOpacity="0.2"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <line
      x1="19"
      y1="15"
      x2="33"
      y2="15"
      stroke="currentColor"
      strokeOpacity="0.2"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const RightIcon = () => (
  <svg width="36" height="24" viewBox="0 0 36 24" fill="none" aria-hidden="true">
    <rect
      x="0.5"
      y="0.5"
      width="35"
      height="23"
      rx="2.5"
      stroke="currentColor"
      strokeOpacity="0.3"
    />
    <rect x="21" y="0.5" width="14.5" height="23" rx="2.5" fill="currentColor" fillOpacity="0.85" />
    <line
      x1="3"
      y1="7"
      x2="17"
      y2="7"
      stroke="currentColor"
      strokeOpacity="0.2"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <line
      x1="3"
      y1="11"
      x2="14"
      y2="11"
      stroke="currentColor"
      strokeOpacity="0.2"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <line
      x1="3"
      y1="15"
      x2="17"
      y2="15"
      stroke="currentColor"
      strokeOpacity="0.2"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

const LAYOUT_OPTIONS: { value: CameraLayoutPreset; Icon: () => JSX.Element }[] = [
  { value: 'pip', Icon: PipIcon },
  { value: 'full', Icon: FullIcon },
  { value: 'left', Icon: LeftIcon },
  { value: 'right', Icon: RightIcon },
];

// ── Widget ────────────────────────────────────────────────────────────────────

export const CameraWidget = () => {
  const { t } = useTranslation('camera');
  const {
    recordingResult,
    camera,
    currentTime,
    cameraClips,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
  } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      camera: state.camera,
      currentTime: state.currentTime,
      cameraClips: state.cameraClips,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
    })),
  );

  const hasCameraTrack = Boolean(recordingResult?.cameraPath);
  const activeClip = findCameraClipAtTime(cameraClips, currentTime);
  const activeLayout: CameraLayoutPreset = activeClip?.layout ?? 'pip';

  const trackCamera = (property: string, value: unknown) =>
    trackEvent('widget_config_changed', { widget: 'camera', property, value });

  const updateCamera = useCallback(
    (label: string, patch: Partial<typeof camera>) => {
      commitEdit(label, (state) => ({
        camera: {
          ...state.camera,
          ...patch,
          shadow: {
            ...state.camera.shadow,
            ...(patch.shadow ?? {}),
          },
        },
      }));
    },
    [commitEdit],
  );

  const handleLayoutChange = useCallback(
    (layout: CameraLayoutPreset) => {
      if (!activeClip) {
        return;
      }
      commitEdit('Change camera layout', (state) => ({
        cameraClips: state.cameraClips.map((c) => (c.id === activeClip.id ? { ...c, layout } : c)),
        ...(layout !== 'pip' ? { frame: { ...state.frame, aspectRatioId: '16:9' } } : {}),
      }));
      trackCamera('layout', layout);
    },
    [activeClip, commitEdit],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!recordingResult ? (
        <>
          <div className={WIDGET_PANEL_HEADER_CLASS}>
            <IconVideo className="size-4.5" />
            {t('header')}
          </div>
          <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
            <IconVideoOff size={34} className="text-sf-muted" />
            <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
          </div>
        </>
      ) : !hasCameraTrack ? (
        <>
          <div className={WIDGET_PANEL_HEADER_CLASS}>
            <IconVideo className="size-4.5" />
            {t('header')}
          </div>
          <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
            <IconVideoOff size={34} className="text-sf-muted" />
            <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noCameraTrack')}</div>
          </div>
        </>
      ) : (
        <WidgetEnabledGate
          title={t('header')}
          icon={<IconVideo className="size-4.5" />}
          enabled={camera.enabled}
          onToggle={(checked) => {
            updateCamera(checked ? 'Show camera' : 'Hide camera', { enabled: checked });
            trackEvent('camera_toggled', { enabled: checked });
            trackCamera('enabled', checked);
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6">
            {/* Layout */}
            <div className="flex flex-col gap-2.5 py-4">
              <span className={WIDGET_SECTION_HEADING_CLASS}>{t('layout')}</span>
              <div className="grid grid-cols-4 gap-1.5">
                {LAYOUT_OPTIONS.map(({ value, Icon }) => {
                  const isActive = activeLayout === value;
                  return (
                    <motion.button
                      key={value}
                      type="button"
                      aria-label={t(value)}
                      aria-pressed={isActive}
                      onClick={() => handleLayoutChange(value)}
                      whileTap={{ scale: 0.94 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                      className={[
                        'flex cursor-pointer flex-col items-center gap-1.5 rounded-md border px-1.5 py-2 transition-[border-color,background-color,color,opacity,box-shadow] duration-200',
                        isActive
                          ? 'border-sf-border-lt bg-[#151519] text-sf-primary ring-1 ring-sf-border-lt'
                          : 'border-[#262629] bg-[#0d0d10] text-sf-secondary opacity-65 hover:border-sf-border-lt hover:text-sf-primary hover:opacity-85',
                      ].join(' ')}
                    >
                      <Icon />
                      <span className="text-[10px] font-medium leading-none tracking-wide">
                        {t(value)}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Shape — only shown for PiP */}
            <AnimatePresence initial={false}>
              {activeLayout === 'pip' && (
                <motion.div
                  key="shape"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{
                    height: 'auto',
                    opacity: 1,
                    transition: { duration: 0.2, ease: 'easeOut' },
                  }}
                  exit={{ height: 0, opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="flex flex-col gap-2.5 border-t border-[#161515] py-4">
                    <span className={WIDGET_SECTION_HEADING_CLASS}>{t('shape')}</span>
                    <ToggleGroup
                      type="single"
                      size="sm"
                      value={camera.shape}
                      onValueChange={(value) => {
                        if (!value) {
                          return;
                        }
                        updateCamera('Change camera shape', {
                          shape: value as typeof camera.shape,
                        });
                        trackCamera('shape', value);
                      }}
                      className="w-full"
                    >
                      <ToggleGroupItem value="square" className="flex-1 text-md">
                        {t('square')}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="horizontal" className="flex-1 text-md">
                        {t('horizontal')}
                      </ToggleGroupItem>
                      <ToggleGroupItem value="vertical" className="flex-1 text-md">
                        {t('vertical')}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Mirror */}
            <div className="flex flex-col gap-2.5 border-t border-[#161515] py-4">
              <span className={WIDGET_SECTION_HEADING_CLASS}>{t('mirror')}</span>
              <ToggleGroup
                type="single"
                size="sm"
                value={camera.mirror ? 'on' : 'off'}
                onValueChange={(value) => {
                  if (!value) {
                    return;
                  }
                  updateCamera('Toggle camera mirror', { mirror: value === 'on' });
                  trackCamera('mirror', value === 'on');
                }}
                className="w-full"
              >
                <ToggleGroupItem value="off" className="flex-1 text-md">
                  {t('off')}
                </ToggleGroupItem>
                <ToggleGroupItem value="on" className="flex-1 text-md">
                  {t('on')}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* Zoom — only shown for PiP */}
            <AnimatePresence initial={false}>
              {activeLayout === 'pip' && (
                <motion.div
                  key="zoom"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{
                    height: 'auto',
                    opacity: 1,
                    transition: { duration: 0.2, ease: 'easeOut' },
                  }}
                  exit={{ height: 0, opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="flex flex-col gap-2.5 border-t border-[#161515] py-4">
                    <span className={WIDGET_SECTION_HEADING_CLASS}>{t('zoom')}</span>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      inlineLabel={t('zoomResponse')}
                      valueLabel={`${Math.round(clamp(camera.zoomResponse, 0, 1) * 100)}%`}
                      value={[Math.round(clamp(camera.zoomResponse, 0, 1) * 100)]}
                      onPointerDown={() =>
                        beginHistoryGroup('camera-zoom-response', 'Adjust camera zoom response')
                      }
                      onValueChange={([value]) =>
                        updateCamera('Adjust camera zoom response', { zoomResponse: value / 100 })
                      }
                      onValueCommit={([value]) => {
                        endHistoryGroup('camera-zoom-response');
                        trackCamera('zoom_response_percent', value);
                      }}
                    />
                    <Slider
                      min={0}
                      max={300}
                      step={1}
                      inlineLabel={t('zoomRadius')}
                      valueLabel={`${Math.round(camera.zoomRadiusScale * 100)}%`}
                      value={[Math.round(camera.zoomRadiusScale * 100)]}
                      onPointerDown={() =>
                        beginHistoryGroup('camera-zoom-radius', 'Adjust camera zoom radius')
                      }
                      onValueChange={([value]) =>
                        updateCamera('Adjust camera zoom radius', { zoomRadiusScale: value / 100 })
                      }
                      onValueCommit={([value]) => {
                        endHistoryGroup('camera-zoom-radius');
                        trackCamera('zoom_radius_scale_pct', value);
                      }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Roundness — only shown for PiP */}
            <AnimatePresence initial={false}>
              {activeLayout === 'pip' && (
                <motion.div
                  key="roundness"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{
                    height: 'auto',
                    opacity: 1,
                    transition: { duration: 0.2, ease: 'easeOut' },
                  }}
                  exit={{ height: 0, opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="flex flex-col gap-2.5 border-t border-[#161515] py-4">
                    <span className={WIDGET_SECTION_HEADING_CLASS}>{t('roundness')}</span>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      inlineLabel={t('roundness')}
                      valueLabel={`${Math.round(clamp(camera.roundness, 0, 1) * 100)}%`}
                      value={[Math.round(clamp(camera.roundness, 0, 1) * 100)]}
                      onPointerDown={() =>
                        beginHistoryGroup('camera-roundness', 'Adjust camera roundness')
                      }
                      onValueChange={([value]) =>
                        updateCamera('Adjust camera roundness', { roundness: value / 100 })
                      }
                      onValueCommit={([value]) => {
                        endHistoryGroup('camera-roundness');
                        trackCamera('roundness_percent', value);
                      }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Panel — only shown for left/right layouts */}
            <AnimatePresence initial={false}>
              {(activeLayout === 'left' || activeLayout === 'right') && (
                <motion.div
                  key="panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{
                    height: 'auto',
                    opacity: 1,
                    transition: { duration: 0.2, ease: 'easeOut' },
                  }}
                  exit={{ height: 0, opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="flex flex-col gap-2.5 border-t border-[#161515] py-4">
                    <span className={WIDGET_SECTION_HEADING_CLASS}>{t('panel')}</span>
                    <div className="flex flex-col gap-2.5">
                      <Slider
                        min={0}
                        max={200}
                        step={1}
                        inlineLabel={t('radius')}
                        valueLabel={`${Math.round(camera.fixedRadius)} px`}
                        value={[Math.round(camera.fixedRadius)]}
                        onPointerDown={() =>
                          beginHistoryGroup('camera-fixed-radius', 'Adjust panel radius')
                        }
                        onValueChange={([value]) =>
                          updateCamera('Adjust panel radius', { fixedRadius: value })
                        }
                        onValueCommit={([value]) => {
                          endHistoryGroup('camera-fixed-radius');
                          trackCamera('fixed_radius_px', value);
                        }}
                      />
                      <Slider
                        min={0}
                        max={120}
                        step={1}
                        inlineLabel={t('padding')}
                        valueLabel={`${Math.round(camera.fixedPadding)} px`}
                        value={[Math.round(camera.fixedPadding)]}
                        onPointerDown={() =>
                          beginHistoryGroup('camera-fixed-padding', 'Adjust panel padding')
                        }
                        onValueChange={([value]) =>
                          updateCamera('Adjust panel padding', { fixedPadding: value })
                        }
                        onValueCommit={([value]) => {
                          endHistoryGroup('camera-fixed-padding');
                          trackCamera('fixed_padding_px', value);
                        }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Zoom — only shown for left/right layouts */}
            <AnimatePresence initial={false}>
              {(activeLayout === 'left' || activeLayout === 'right') && (
                <motion.div
                  key="zoom-fixed"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{
                    height: 'auto',
                    opacity: 1,
                    transition: { duration: 0.2, ease: 'easeOut' },
                  }}
                  exit={{ height: 0, opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } }}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="flex flex-col gap-2.5 border-t border-[#161515] py-4">
                    <span className={WIDGET_SECTION_HEADING_CLASS}>{t('zoom')}</span>
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      inlineLabel={t('zoomResponse')}
                      valueLabel={`${Math.round(clamp(camera.zoomResponse, 0, 1) * 100)}%`}
                      value={[Math.round(clamp(camera.zoomResponse, 0, 1) * 100)]}
                      onPointerDown={() =>
                        beginHistoryGroup('camera-zoom-response', 'Adjust camera zoom response')
                      }
                      onValueChange={([value]) =>
                        updateCamera('Adjust camera zoom response', { zoomResponse: value / 100 })
                      }
                      onValueCommit={([value]) => {
                        endHistoryGroup('camera-zoom-response');
                        trackCamera('zoom_response_percent', value);
                      }}
                    />
                    <Slider
                      min={0}
                      max={300}
                      step={1}
                      inlineLabel={t('zoomRadius')}
                      valueLabel={`${Math.round(camera.zoomRadiusScale * 100)}%`}
                      value={[Math.round(camera.zoomRadiusScale * 100)]}
                      onPointerDown={() =>
                        beginHistoryGroup('camera-zoom-radius', 'Adjust zoom radius')
                      }
                      onValueChange={([value]) =>
                        updateCamera('Adjust zoom radius', { zoomRadiusScale: value / 100 })
                      }
                      onValueCommit={([value]) => {
                        endHistoryGroup('camera-zoom-radius');
                        trackCamera('zoom_radius_scale_pct', value);
                      }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Shadow */}
            <div className="flex flex-col gap-2.5 border-t border-[#161515] pt-4">
              <span className={WIDGET_SECTION_HEADING_CLASS}>{t('shadow')}</span>
              <div className="flex flex-col gap-2.5">
                <Slider
                  min={0}
                  max={64}
                  step={1}
                  inlineLabel={t('blur')}
                  valueLabel={`${Math.round(camera.shadow.blur)} px`}
                  value={[Math.round(camera.shadow.blur)]}
                  onPointerDown={() =>
                    beginHistoryGroup('camera-shadow-blur', 'Adjust camera shadow blur')
                  }
                  onValueChange={([value]) =>
                    updateCamera('Adjust camera shadow blur', { shadow: { blur: value } })
                  }
                  onValueCommit={([value]) => {
                    endHistoryGroup('camera-shadow-blur');
                    trackCamera('shadow_blur_px', value);
                  }}
                />
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  inlineLabel={t('opacity')}
                  valueLabel={`${Math.round(camera.shadow.opacity * 100)}%`}
                  value={[Math.round(camera.shadow.opacity * 100)]}
                  onPointerDown={() =>
                    beginHistoryGroup('camera-shadow-opacity', 'Adjust camera shadow opacity')
                  }
                  onValueChange={([value]) =>
                    updateCamera('Adjust camera shadow opacity', {
                      shadow: { opacity: value / 100 },
                    })
                  }
                  onValueCommit={([value]) => {
                    endHistoryGroup('camera-shadow-opacity');
                    trackCamera('shadow_opacity_percent', value);
                  }}
                />
              </div>
            </div>
          </div>
        </WidgetEnabledGate>
      )}
    </div>
  );
};
