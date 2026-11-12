import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { trackEvent } from 'src/lib/analytics';
import { getInitialPlaybackTime } from 'src/lib/helpers/segments';
import { IconBrowser } from 'src/lib/icons';
import { DEFAULT_WINDOW_BAR, activeBarStyle, type WindowBarSettings } from 'src/lib/window-bar';
import { windowBarStartText } from 'src/lib/recording/captureSource';
import { applyRecordedBar } from 'src/lib/recording/recordedBar';
import type { FrameSettings } from 'src/lib/effects/frame';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { WindowBarControls } from 'src/components/WindowBarControls';
import { useStore } from '../../../store';
import { RecordedBarCropSection } from './RecordedBarCropSection';
import { WidgetEnabledGate } from './WidgetEnabledGate';

/** The frame with a new window bar, the recorded toolbar's crop following it on or off. */
const withWindowBar = (frame: FrameSettings, windowBar: WindowBarSettings): FrameSettings => {
  const next = { ...frame, windowBar };
  return next.recordedBar
    ? applyRecordedBar(next, next.recordedBar, next.recordedBar.height)
    : next;
};

/**
 * The window bar drawn over the recording (and offered to screenshots): off
 * until switched on, then a Mac, Windows or browser bar, its theme, and the
 * words in the middle. Below it, the recorded toolbar crop for the person's
 * own browser recordings, which only applies while the bar is on.
 */
export const WindowWidget = () => {
  const { t } = useTranslation('frame');
  const {
    frame,
    recordingResult,
    mediaSegments,
    requestPauseAndSeekTo,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
  } = useStore(
    useShallow((state) => ({
      frame: state.frame,
      recordingResult: state.recordingResult,
      mediaSegments: state.mediaSegments,
      requestPauseAndSeekTo: state.requestPauseAndSeekTo,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
    })),
  );

  if (!recordingResult) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={WIDGET_PANEL_HEADER_CLASS}>
          <IconBrowser className="size-4.5" />
          {t('windowHeader')}
        </div>

        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconBrowser size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  const enabled = activeBarStyle(frame.windowBar) !== 'none';
  // What the controls show while switched off: the bar it would turn on as.
  const windowBar: WindowBarSettings = {
    ...DEFAULT_WINDOW_BAR,
    center: 'custom',
    customText: windowBarStartText(recordingResult),
    ...frame.windowBar,
    ...(frame.windowBar?.style === 'none' || !frame.windowBar ? { style: 'mac' as const } : {}),
  };

  const patchWindowBar = (label: string, patch: Partial<WindowBarSettings>) => {
    requestPauseAndSeekTo(getInitialPlaybackTime(mediaSegments));
    commitEdit(label, (state) => ({
      frame: withWindowBar(state.frame, { ...windowBar, ...state.frame.windowBar, ...patch }),
    }));
    const [property, value] = Object.entries(patch)[0] ?? [];
    if (property && property !== 'customText' && property !== 'center') {
      trackEvent('widget_config_changed', { widget: 'window', property, value });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WidgetEnabledGate
        title={t('windowHeader')}
        icon={<IconBrowser className="size-4.5" />}
        enabled={enabled}
        onToggle={(checked) => {
          requestPauseAndSeekTo(getInitialPlaybackTime(mediaSegments));
          commitEdit(checked ? 'Show window bar' : 'Hide window bar', (state) => ({
            // Switching on starts from what the controls show (Mac, the
            // page's title or a placeholder address); off keeps it for later.
            frame: withWindowBar(state.frame, { ...windowBar, enabled: checked }),
          }));
          trackEvent('widget_config_changed', {
            widget: 'window',
            property: 'enabled',
            value: checked,
          });
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6">
          <section className="flex flex-col gap-4">
            <div className={WIDGET_SECTION_HEADING_CLASS}>{t('windowBar')}</div>
            <WindowBarControls
              value={windowBar}
              onChange={patchWindowBar}
              onTextEditStart={() => beginHistoryGroup('window-bar-text', 'Change window bar text')}
              onTextEditEnd={() => endHistoryGroup('window-bar-text')}
            />
            <RecordedBarCropSection />
          </section>
        </div>
      </WidgetEnabledGate>
    </div>
  );
};
