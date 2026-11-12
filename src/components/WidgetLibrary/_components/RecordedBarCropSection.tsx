import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { trackEvent } from 'src/lib/analytics';
import { getInitialPlaybackTime } from 'src/lib/helpers/segments';
import type { RecordedBarSettings } from 'src/lib/effects/frame';
import type { RecordedBarCropMode } from 'src/lib/window-bar';
import {
  applyRecordedBar,
  recordedBarEligibility,
  withRecordedBarMode,
} from 'src/lib/recording/recordedBar';
import { WIDGET_SECTION_HEADING_CLASS } from 'src/components/layout';
import { Button, ToggleGroup, ToggleGroupItem } from '../../../lib/ui';
import { useStore } from '../../../store';

const MODES: RecordedBarCropMode[] = ['auto', 'manual', 'off'];

/**
 * "Recorded toolbar": a window recording of a browser carries the browser's
 * own toolbar, which would sit under the new window bar. Auto crops it off
 * when detection is sure, Manual uses a line the person drags, Off keeps it.
 * Only offered for window recordings: a shared tab has no toolbar, and a
 * screen has no single window.
 */
export const RecordedBarCropSection = () => {
  const { t } = useTranslation('frame');
  const {
    frame,
    recordingResult,
    mediaSegments,
    isCropEditing,
    cropEditTarget,
    setIsCropEditing,
    requestPauseAndSeekTo,
    commitEdit,
  } = useStore(
    useShallow((state) => ({
      frame: state.frame,
      recordingResult: state.recordingResult,
      mediaSegments: state.mediaSegments,
      isCropEditing: state.isCropEditing,
      cropEditTarget: state.cropEditTarget,
      setIsCropEditing: state.setIsCropEditing,
      requestPauseAndSeekTo: state.requestPauseAndSeekTo,
      commitEdit: state.commitEdit,
    })),
  );

  if (!recordingResult || recordedBarEligibility(recordingResult.captureSource) !== 'detect') {
    return null;
  }

  const bar = frame.recordedBar;
  const editingLine = isCropEditing && cropEditTarget === 'recordedBar';

  const commitBar = (label: string, next: RecordedBarSettings) =>
    commitEdit(label, (state) => ({
      frame: applyRecordedBar(state.frame, next, next.height),
    }));

  const setMode = (mode: RecordedBarCropMode) => {
    if (!bar) {
      return;
    }
    commitBar('Change recorded toolbar crop', withRecordedBarMode(bar, mode));
    trackEvent('widget_config_changed', {
      widget: 'frame',
      property: 'recorded_bar',
      value: mode,
    });
    if (mode !== 'manual' && editingLine) {
      setIsCropEditing(false);
    }
  };

  const adjust = () => {
    if (!bar) {
      return;
    }
    // Dragging the line is a manual crop, starting from detection's guess.
    if (bar.mode !== 'manual') {
      commitBar('Adjust recorded toolbar crop', { ...bar, mode: 'manual' });
    }
    requestPauseAndSeekTo(getInitialPlaybackTime(mediaSegments));
    setIsCropEditing(true, 'recordedBar');
  };

  const status = !bar
    ? t('recordedBarStatus.detecting')
    : bar.mode === 'off'
      ? t('recordedBarStatus.off')
      : bar.mode === 'manual'
        ? t('recordedBarStatus.manual', { rows: bar.cropTop })
        : t(`recordedBarStatus.${bar.detected}`);

  return (
    <div className="flex flex-col gap-4 border-t border-[#161515] pt-4">
      <div className={WIDGET_SECTION_HEADING_CLASS}>{t('recordedBar')}</div>
      <ToggleGroup
        type="single"
        size="sm"
        value={bar?.mode ?? 'auto'}
        disabled={!bar}
        aria-label={t('recordedBar')}
        onValueChange={(value) => {
          if (value) {
            setMode(value as RecordedBarCropMode);
          }
        }}
        className="w-full"
      >
        {MODES.map((mode) => (
          <ToggleGroupItem key={mode} value={mode} className="flex-1 text-md">
            {t(`recordedBarMode.${mode}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs leading-snug text-sf-secondary" aria-live="polite">
        {status}
      </p>
      {bar && bar.mode !== 'off' && (
        <Button
          size="sm"
          variant={editingLine ? 'default' : 'outline'}
          className="w-full"
          onClick={() => (editingLine ? setIsCropEditing(false) : adjust())}
        >
          {editingLine ? t('done') : t('adjustCrop')}
        </Button>
      )}
    </div>
  );
};
