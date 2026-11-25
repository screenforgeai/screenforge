import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from 'src/lib/ui';
import { formatDisplaySize } from 'src/lib/recording/displayChoice';
import type { DisplayPickerPurpose, DisplayPickerTarget } from 'src/types';

// The same dim as the area selector; lighter on the monitor under the cursor.
const SCRIM = 'rgba(0,0,0,0.65)';
const SCRIM_HOVERED = 'rgba(0,0,0,0.35)';

const ACTION_KEY: Record<
  DisplayPickerPurpose,
  'displayPick_record' | 'displayPick_screenshot' | 'displayPick_area'
> = {
  record: 'displayPick_record',
  screenshot: 'displayPick_screenshot',
  area: 'displayPick_area',
};

/**
 * Covers one monitor while choosing which to capture: clicking anywhere on it picks it. Number keys pick a monitor by the number shown on it; Esc cancels.
 */
export const DisplayPicker = () => {
  const { t } = useTranslation('toolbar');
  const [target, setTarget] = useState<DisplayPickerTarget | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.screenforge
      .getDisplayPickerTarget()
      .then((value) => {
        if (!cancelled) {
          setTarget(value);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const pick = useCallback(() => {
    void window.screenforge.confirmDisplayPick();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.screenforge.cancelDisplayPick();
        return;
      }
      if (event.key === 'Enter') {
        pick();
        return;
      }
      const number = Number.parseInt(event.key, 10);
      if (target && Number.isInteger(number) && number >= 1 && number <= target.count) {
        void window.screenforge.confirmDisplayPick(number);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pick, target]);

  if (!target) {
    return null;
  }

  const { display, number, purpose } = target;
  const name = display.label ?? t('displayN', { n: number });
  const detail = [formatDisplaySize(display), display.isPrimary ? t('displayMain') : null]
    .filter(Boolean)
    .join(' · ');
  const action = t(ACTION_KEY[purpose]);

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`${action}: ${name}`}
      onClick={pick}
      onMouseEnter={() => setHovered(true)}
      onMouseMove={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="fixed inset-0 flex cursor-pointer select-none items-center justify-center transition-[background-color,box-shadow] duration-[160ms] ease-out motion-reduce:transition-none"
      style={{
        background: hovered ? SCRIM_HOVERED : SCRIM,
        boxShadow: hovered ? 'inset 0 0 0 2px var(--color-sf-secondary)' : 'none',
      }}
    >
      <div className="flex w-[280px] flex-col gap-4 rounded-xl bg-sf-panel p-4">
        <div className="flex items-center gap-3">
          <kbd className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sf-border font-sans text-sm font-medium text-sf-primary tabular-nums">
            {number}
          </kbd>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-sf-primary">{name}</span>
            <span className="truncate text-xs text-sf-secondary tabular-nums">{detail}</span>
          </div>
        </div>
        <Button
          size="sm"
          className="w-full cursor-pointer text-sm"
          onClick={(event) => {
            event.stopPropagation();
            pick();
          }}
        >
          {action}
        </Button>
        <span className="text-xs text-sf-secondary">{t('displayPick_hint')}</span>
      </div>
    </div>
  );
};
