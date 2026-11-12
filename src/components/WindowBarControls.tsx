import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from 'src/lib/utils';
import { IconCheck, IconChevronDown } from 'src/lib/icons';
import type {
  WindowBarCenter,
  WindowBarSettings,
  WindowBarStyle,
  WindowBarTheme,
} from 'src/lib/window-bar';
import { WIDGET_SECTION_HEADING_CLASS } from 'src/components/layout';
import {
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from 'src/lib/ui';

const STYLE_VALUES: WindowBarStyle[] = ['none', 'mac', 'windows', 'browser'];
const THEME_VALUES: WindowBarTheme[] = ['auto', 'light', 'dark'];
const CENTER_VALUES: WindowBarCenter[] = ['url', 'domain', 'title', 'custom', 'none'];

/** Longest custom text the bar takes; the address box cuts it to fit anyway. */
const CUSTOM_TEXT_MAX = 80;

type Props = {
  value: WindowBarSettings;
  /** `label` names the undo step. */
  onChange: (label: string, patch: Partial<WindowBarSettings>) => void;
  /** Whether this recording's address is known; without it Live URL and Domain stay empty. */
  hasAddress: boolean;
  /** Typing custom text: start and end one undo step for the whole text. */
  onTextEditStart?: () => void;
  onTextEditEnd?: () => void;
  /** Between rows: the Frame widget's hairline by default. */
  dividerClassName?: string;
};

/**
 * The window bar's settings, shared by the Window widget and the screenshot
 * editor: a style, then (with a bar) its theme and what it shows in the
 * middle. The lock comes with an address by itself, so there's no switch.
 */
export const WindowBarControls = ({
  value,
  onChange,
  hasAddress,
  onTextEditStart,
  onTextEditEnd,
  dividerClassName = 'border-[#161515]',
}: Props) => {
  const { t } = useTranslation('frame');
  const hasBar = value.style !== 'none';
  const centerLabel = value.style === 'windows' ? t('windowTitle') : t('windowCenter');

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

      {hasBar && (
        <>
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
            {/* A Windows bar has a title where the others have an address. */}
            <div className={WIDGET_SECTION_HEADING_CLASS}>{centerLabel}</div>
            <CenterPicker
              value={value}
              label={centerLabel}
              hasAddress={hasAddress}
              onChange={onChange}
              onTextEditStart={onTextEditStart}
              onTextEditEnd={onTextEditEnd}
            />
          </div>
        </>
      )}
    </>
  );
};

/**
 * What the middle of the bar shows, picked from a list where each choice
 * reads as it would on a page. Custom text is typed right there in the list.
 */
const CenterPicker = ({
  value,
  label,
  hasAddress,
  onChange,
  onTextEditStart,
  onTextEditEnd,
}: {
  value: WindowBarSettings;
  label: string;
  hasAddress: boolean;
  onChange: (label: string, patch: Partial<WindowBarSettings>) => void;
  onTextEditStart?: () => void;
  onTextEditEnd?: () => void;
}) => {
  const { t } = useTranslation('frame');
  const [open, setOpen] = useState(false);
  const customInputRef = useRef<HTMLInputElement>(null);
  const customText = value.customText ?? '';

  const sampleFor = (center: WindowBarCenter): string => {
    if (center === 'none') {
      return t(`windowCenterEmpty.${value.style === 'none' ? 'mac' : value.style}`);
    }
    if (center === 'custom' && customText.trim()) {
      return customText.trim();
    }
    return t(`windowCenterSample.${center}`);
  };

  const choose = (center: WindowBarCenter) => {
    if (center !== value.center) {
      onChange('Change window bar text', { center });
    }
    if (center === 'custom') {
      // Stays open: the text is typed in the list.
      requestAnimationFrame(() => customInputRef.current?.focus());
    } else {
      setOpen(false);
    }
  };

  const addressOnly = value.center === 'url' || value.center === 'domain';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="cursor-pointer relative flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3.5 py-2 text-md font-medium tracking-[-0.01em] text-sf-primary shadow-xs outline-none transition-[border-color,background-color,box-shadow,color] duration-150 ease-out dark:bg-input/30 hover:border-sf-border-lt hover:bg-sf-panel/70 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] data-[state=open]:border-sf-border-lt data-[state=open]:bg-sf-panel"
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            {t(`windowCenterOption.${value.center}`)}
            {value.center === 'custom' && customText.trim() && (
              <span className="truncate font-normal text-sf-muted">{customText.trim()}</span>
            )}
          </span>
          <IconChevronDown size={16} className="shrink-0 text-sf-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 border-sf-border bg-sf-panel p-1.5 text-sf-primary shadow-[0_1px_1px_rgba(0,0,0,0.2),0_12px_32px_rgba(0,0,0,0.3)]"
      >
        <div role="radiogroup" aria-label={label} className="flex flex-col">
          {CENTER_VALUES.map((center) => {
            const selected = center === value.center;
            return (
              <Button
                key={center}
                type="button"
                variant="ghost"
                role="radio"
                aria-checked={selected}
                onClick={() => choose(center)}
                className={cn(
                  'h-auto w-full justify-start gap-2 rounded-md px-3 py-2 text-left shadow-none hover:bg-[#1a1a20]',
                  selected && 'bg-[#17171c]',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-md font-medium text-sf-primary">
                    {t(`windowCenterOption.${center}`)}
                  </span>
                  <span className="truncate text-xs font-normal text-sf-muted">
                    {sampleFor(center)}
                  </span>
                </span>
                {selected && <IconCheck size={14} className="shrink-0 text-sf-primary" />}
              </Button>
            );
          })}
        </div>
        {value.center === 'custom' && (
          <div className="px-1 pt-2 pb-1">
            <Input
              ref={customInputRef}
              aria-label={t('windowCustomText')}
              placeholder={t('windowCustomPlaceholder')}
              value={customText}
              maxLength={CUSTOM_TEXT_MAX}
              // One undo step for the whole text, not one per keystroke.
              onFocus={onTextEditStart}
              onBlur={onTextEditEnd}
              onChange={(event) =>
                onChange('Change window bar text', { customText: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setOpen(false);
                }
              }}
            />
          </div>
        )}
        {!hasAddress && addressOnly && (
          <p className="px-3 pt-2 pb-1 text-xs leading-snug text-sf-muted">
            {t('windowNoAddress')}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
};
