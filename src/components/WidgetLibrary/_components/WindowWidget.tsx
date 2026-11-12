import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { trackEvent } from 'src/lib/analytics';
import { getInitialPlaybackTime } from 'src/lib/helpers/segments';
import { IconAppWindow } from 'src/lib/icons';
import { DEFAULT_WINDOW_BAR, type WindowBarSettings } from 'src/lib/window-bar';
import { recordingPageVisits } from 'src/lib/recording/captureSource';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { WindowBarControls } from 'src/components/WindowBarControls';
import { useStore } from '../../../store';
import { RecordedBarCropSection } from './RecordedBarCropSection';

/**
 * The window bar drawn over the recording (and offered to screenshots): a
 * Mac, Windows or browser bar, its theme, and what it shows. Below it, the
 * recorded toolbar crop for the person's own browser recordings.
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
          <IconAppWindow className="size-4.5" />
          {t('windowHeader')}
        </div>

        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconAppWindow size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  const windowBar = { ...DEFAULT_WINDOW_BAR, ...frame.windowBar };
  // Screenforge knows a window's title, not its address (yet).
  const hasAddress = recordingPageVisits(recordingResult).some((visit) => visit.url !== '');

  const patchWindowBar = (label: string, patch: Partial<WindowBarSettings>) => {
    requestPauseAndSeekTo(getInitialPlaybackTime(mediaSegments));
    commitEdit(label, (state) => ({
      frame: {
        ...state.frame,
        windowBar: { ...DEFAULT_WINDOW_BAR, ...state.frame.windowBar, ...patch },
      },
    }));
    const [property, value] = Object.entries(patch)[0] ?? [];
    if (property && property !== 'customText') {
      trackEvent('widget_config_changed', { widget: 'window', property, value });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={WIDGET_PANEL_HEADER_CLASS}>
        <IconAppWindow className="size-4.5" />
        {t('windowHeader')}
      </div>

      <div className="flex min-h-0 flex-1 flex-col divide-y divide-[#161515] overflow-y-auto px-4 pb-6">
        <section className="flex flex-col gap-4">
          <div className={WIDGET_SECTION_HEADING_CLASS}>{t('windowBar')}</div>
          <WindowBarControls
            value={windowBar}
            hasAddress={hasAddress}
            onChange={patchWindowBar}
            onTextEditStart={() =>
              beginHistoryGroup('window-custom-text', 'Change window bar text')
            }
            onTextEditEnd={() => endHistoryGroup('window-custom-text')}
          />
          <RecordedBarCropSection />
        </section>
      </div>
    </div>
  );
};
