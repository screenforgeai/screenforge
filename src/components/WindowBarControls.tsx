import type React from 'react';
import { useTranslation } from 'react-i18next';
import type { WindowBarSettings, WindowBarStyle, WindowBarTheme } from 'src/lib/window-bar';
import { Input, ToggleGroup, ToggleGroupItem } from 'src/lib/ui';

const STYLE_VALUES: Exclude<WindowBarStyle, 'none'>[] = ['mac', 'windows', 'browser'];
const THEME_VALUES: WindowBarTheme[] = ['auto', 'light', 'dark'];

/** Longest text the bar takes; the address box cuts it to fit anyway. */
const TEXT_MAX = 80;

type Props = {
  value: WindowBarSettings;
  /** `label` names the undo step. */
  onChange: (label: string, patch: Partial<WindowBarSettings>) => void;
  /** Typing the text: start and end one undo step for the whole edit. */
  onTextEditStart?: () => void;
  onTextEditEnd?: () => void;
};

/** A small label over its control, inside a section (the Style panel's own pattern). */
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-2">
    <div className="text-xs font-medium text-sf-secondary">{label}</div>
    {children}
  </div>
);

/**
 * The window bar's settings, shared by the Window widget and the screenshot
 * editor (each puts the section heading and its on/off switch above them):
 * one group of rows for the style, the theme and the words in the middle.
 * Text that reads as an address gets the lock by itself.
 */
export const WindowBarControls = ({ value, onChange, onTextEditStart, onTextEditEnd }: Props) => {
  const { t } = useTranslation('frame');
  // A Windows bar has a title where the others have an address.
  const textLabel = value.style === 'windows' ? t('windowTitle') : t('windowAddress');

  return (
    <div className="flex flex-col gap-4">
      <Row label={t('windowStyleLabel')}>
        <ToggleGroup
          type="single"
          size="sm"
          value={value.style}
          aria-label={t('windowStyleLabel')}
          onValueChange={(next) => {
            if (next) {
              onChange('Change window bar', { style: next as WindowBarStyle });
            }
          }}
          className="w-full"
        >
          {STYLE_VALUES.map((style) => (
            <ToggleGroupItem key={style} value={style} className="flex-1 text-md">
              {t(`windowStyle.${style}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>

      <Row label={t('windowThemeLabel')}>
        <ToggleGroup
          type="single"
          size="sm"
          value={value.theme}
          aria-label={t('windowThemeLabel')}
          onValueChange={(next) => {
            if (next) {
              onChange('Change window bar theme', { theme: next as WindowBarTheme });
            }
          }}
          className="w-full"
        >
          {THEME_VALUES.map((theme) => (
            <ToggleGroupItem key={theme} value={theme} className="flex-1 text-md">
              {t(`windowTheme.${theme}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>

      <Row label={textLabel}>
        <Input
          aria-label={textLabel}
          value={value.customText ?? ''}
          maxLength={TEXT_MAX}
          spellCheck={false}
          onFocus={onTextEditStart}
          onBlur={onTextEditEnd}
          onChange={(event) =>
            onChange('Change window bar text', {
              center: 'custom',
              customText: event.target.value,
            })
          }
        />
      </Row>
    </div>
  );
};
