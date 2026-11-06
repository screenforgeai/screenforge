import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { Button, Slider, ToggleGroup, ToggleGroupItem } from 'src/lib/ui';
import {
  DEFAULT_LOGO_SETTINGS,
  LOGO_CORNERS,
  LOGO_SIZE_MAX,
  LOGO_SIZE_MIN,
  type LogoCorner,
  type LogoSettings,
} from 'src/lib/effects/logo/layout';
import { WIDGET_SECTION_HEADING_CLASS } from 'src/components/layout';
import { useStore } from '../../../store';

/** Same limit as a preset logo, so a project logo can always be saved in a preset. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const CORNER_LABEL_KEYS: Record<
  LogoCorner,
  'logoCornerTopLeft' | 'logoCornerTopRight' | 'logoCornerBottomLeft' | 'logoCornerBottomRight'
> = {
  'top-left': 'logoCornerTopLeft',
  'top-right': 'logoCornerTopRight',
  'bottom-left': 'logoCornerBottomLeft',
  'bottom-right': 'logoCornerBottomRight',
};

const CORNER_GLYPHS: Record<LogoCorner, string> = {
  'top-left': '↖',
  'top-right': '↗',
  'bottom-left': '↙',
  'bottom-right': '↘',
};

/** The Frame widget's logo: add one, move it to a corner, size, fade or remove it. */
export const LogoSection = () => {
  const { t } = useTranslation('frame');
  const inputRef = useRef<HTMLInputElement>(null);
  const { logo, commitEdit, beginHistoryGroup, endHistoryGroup } = useStore(
    useShallow((state) => ({
      logo: state.frame.logo ?? null,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
    })),
  );

  const setLogo = (label: string, next: LogoSettings | null) =>
    commitEdit(label, (state) => ({ frame: { ...state.frame, logo: next } }));

  const patchLogo = (label: string, patch: Partial<LogoSettings>) =>
    commitEdit(label, (state) =>
      state.frame.logo
        ? { frame: { ...state.frame, logo: { ...state.frame.logo, ...patch } } }
        : {},
    );

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t('logoTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith('data:image/')) {
        toast.error(t('logoUnreadable'));
        return;
      }
      const placement = logo ?? DEFAULT_LOGO_SETTINGS;
      setLogo(logo ? 'Replace logo' : 'Add logo', {
        src: reader.result,
        corner: placement.corner,
        size: placement.size,
        opacity: placement.opacity,
      });
    };
    reader.onerror = () => toast.error(t('logoUnreadable'));
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-4 border-t border-[#161515] pt-4">
      <div className={WIDGET_SECTION_HEADING_CLASS}>{t('logo')}</div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        aria-label={t('logoImage')}
        className="sr-only"
        onChange={handlePick}
      />

      {!logo ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => inputRef.current?.click()}
        >
          {t('logoAdd')}
        </Button>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-sf-border bg-sf-panel p-1">
              <img
                src={logo.src}
                alt=""
                className="max-h-full max-w-full object-contain"
                draggable={false}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => inputRef.current?.click()}
            >
              {t('logoReplace')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => setLogo('Remove logo', null)}
            >
              {t('logoRemove')}
            </Button>
          </div>

          <ToggleGroup
            type="single"
            size="sm"
            value={logo.corner}
            aria-label={t('logoCorner')}
            onValueChange={(value) => {
              if (value) {
                patchLogo('Move logo', { corner: value as LogoCorner });
              }
            }}
            className="w-full"
          >
            {LOGO_CORNERS.map((corner) => (
              <ToggleGroupItem
                key={corner}
                value={corner}
                aria-label={t(CORNER_LABEL_KEYS[corner])}
                title={t(CORNER_LABEL_KEYS[corner])}
                className="flex-1 text-md"
              >
                {CORNER_GLYPHS[corner]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <Slider
            min={Math.round(LOGO_SIZE_MIN * 100)}
            max={Math.round(LOGO_SIZE_MAX * 100)}
            step={1}
            inlineLabel={t('logoSize')}
            valueLabel={`${Math.round(logo.size * 100)}%`}
            value={[Math.round(logo.size * 100)]}
            onPointerDown={() => beginHistoryGroup('frame-logo-size', 'Resize logo')}
            onValueChange={([value]) => patchLogo('Resize logo', { size: value / 100 })}
            onValueCommit={() => endHistoryGroup('frame-logo-size')}
          />
          <Slider
            min={0}
            max={100}
            step={1}
            inlineLabel={t('opacity')}
            valueLabel={`${Math.round(logo.opacity)}%`}
            value={[Math.round(logo.opacity)]}
            onPointerDown={() => beginHistoryGroup('frame-logo-opacity', 'Adjust logo opacity')}
            onValueChange={([value]) => patchLogo('Adjust logo opacity', { opacity: value })}
            onValueCommit={() => endHistoryGroup('frame-logo-opacity')}
          />
        </>
      )}
    </div>
  );
};
