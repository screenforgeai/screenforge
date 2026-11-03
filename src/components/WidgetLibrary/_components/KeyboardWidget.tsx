import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trackEvent } from 'src/lib/analytics';
import { useShallow } from 'zustand/react/shallow';
import { ToggleGroup, ToggleGroupItem } from '../../../lib/ui';
import { useStore } from '../../../store';
import { IconKeyboard } from 'src/lib/icons';
import { analyzeKeyboardData } from '../../../lib/effects/keyboard/analyze';
import {
  KEYBOARD_CAPTION_BACKGROUND_OPTIONS,
  KEYBOARD_CAPTION_SIZE_OPTIONS,
} from '../../../lib/effects/keyboard/style';
import { triggerKeyboardPreview } from '../../../lib/effects/keyboard/preview';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { WidgetEnabledGate } from './WidgetEnabledGate';

export const KeyboardWidget = () => {
  const { t } = useTranslation('keyboard');
  const { recordingResult, keyboard, commitEdit } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      keyboard: state.keyboard,
      commitEdit: state.commitEdit,
    })),
  );

  const keyboardData = useMemo(
    () => (recordingResult ? analyzeKeyboardData(recordingResult) : null),
    [recordingResult],
  );
  const hasKeyboardEvents = (keyboardData?.keyEvents.length ?? 0) > 0;
  const hasCombos = (keyboardData?.comboEvents.length ?? 0) > 0;

  const updateKeyboard = useCallback(
    (label: string, patch: Partial<typeof keyboard>) => {
      commitEdit(label, (state) => ({
        keyboard: {
          ...state.keyboard,
          ...patch,
        },
      }));
    },
    [commitEdit],
  );

  const trackKeyboard = (property: string, value: unknown) =>
    trackEvent('widget_config_changed', { widget: 'keyboard', property, value });

  const emptyState = (message: string) => (
    <>
      <div className={WIDGET_PANEL_HEADER_CLASS}>
        <IconKeyboard className="size-4.5" />
        {t('header')}
      </div>
      <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
        <IconKeyboard size={34} className="text-sf-muted" />
        <div className={WIDGET_EMPTY_TITLE_CLASS}>{message}</div>
      </div>
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!recordingResult ? (
        emptyState(t('noRecordingSelected'))
      ) : !hasKeyboardEvents ? (
        emptyState(t('noKeyboardData'))
      ) : !hasCombos ? (
        emptyState(t('noShortcuts'))
      ) : (
        <WidgetEnabledGate
          title={t('header')}
          icon={<IconKeyboard className="size-4.5" />}
          enabled={keyboard.enabled}
          onToggle={(checked) => {
            updateKeyboard(checked ? 'Show keyboard captions' : 'Hide keyboard captions', {
              enabled: checked,
            });
            trackEvent('keyboard_toggled', { enabled: checked });
            trackKeyboard('enabled', checked);
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6">
            <section className="flex flex-col gap-4">
              {/* Size */}
              <div className="flex flex-col gap-4 pt-4">
                <div className={WIDGET_SECTION_HEADING_CLASS}>{t('size')}</div>
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={keyboard.size}
                  onValueChange={(value) => {
                    if (!value) {
                      return;
                    }
                    updateKeyboard('Change keyboard caption size', {
                      size: value as typeof keyboard.size,
                    });
                    triggerKeyboardPreview();
                    trackKeyboard('size', value);
                  }}
                  className="w-full"
                >
                  {KEYBOARD_CAPTION_SIZE_OPTIONS.map((option) => (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      className="flex-1 text-md"
                    >
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {/* Background */}
              <div className="flex flex-col gap-4 border-t border-[#161515] pt-4">
                <div className={WIDGET_SECTION_HEADING_CLASS}>{t('background')}</div>
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={keyboard.background}
                  onValueChange={(value) => {
                    if (!value) {
                      return;
                    }
                    updateKeyboard('Change keyboard caption background', {
                      background: value as typeof keyboard.background,
                    });
                    triggerKeyboardPreview();
                    trackKeyboard('background', value);
                  }}
                  className="w-full"
                >
                  {KEYBOARD_CAPTION_BACKGROUND_OPTIONS.map((option) => (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      className="flex-1 text-md"
                    >
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </section>
          </div>
        </WidgetEnabledGate>
      )}
    </div>
  );
};
