import { useTranslation } from 'react-i18next';
import { cn } from 'src/lib/utils';
import type { WindowBarSettings, WindowBarStyle, WindowBarTheme } from 'src/lib/window-bar';
import { WIDGET_SECTION_HEADING_CLASS } from 'src/components/layout';
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
  /** Between rows: the Frame widget's hairline by default. */
  dividerClassName?: string;
};

/**
 * The window bar's settings, shared by the Window widget and the screenshot
 * editor (each puts its own on/off switch above them): a style, its theme,
 * and the words in the middle. Text that reads as an address gets the lock
 * by itself.
 */
export const WindowBarControls = ({
  value,
  onChange,
  onTextEditStart,
  onTextEditEnd,
  dividerClassName = 'border-[#161515]',
}: Props) => {
  const { t } = useTranslation('frame');
  // A Windows bar has a title where the others have an address.
  const textLabel = value.style === 'windows' ? t('windowTitle') : t('windowAddress');

  return (
    <>
      <ToggleGroup
        type="single"
        size="sm"
        value={value.style}
        aria-label={t('windowBar')}
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

      <div className={cn('flex flex-col gap-4 border-t pt-4', dividerClassName)}>
        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('windowThemeLabel')}</div>
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
      </div>

      <div className={cn('flex flex-col gap-4 border-t pt-4', dividerClassName)}>
        <div className={WIDGET_SECTION_HEADING_CLASS}>{textLabel}</div>
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
      </div>
    </>
  );
};
