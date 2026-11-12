import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ASPECT_RATIO_PRESETS,
  GRADIENT_PRESETS,
  WALLPAPER_PRESETS,
  type BackgroundSettings,
  type BackgroundType,
} from 'src/lib/effects/frame';
import { FLAT_STUDIO, type ScreenshotStyle } from 'src/lib/screenshot/compose';
import {
  Button,
  PreviewCardBody,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  SwitchThumb,
  ToggleGroup,
  ToggleGroupItem,
  usePreviewCard,
} from 'src/lib/ui';
import { cn } from 'src/lib/utils';
import { WIDGET_SECTION_HEADING_CLASS } from 'src/components/layout';
import { WindowBarControls } from 'src/components/WindowBarControls';
import {
  DEFAULT_WINDOW_BAR,
  activeBarStyle,
  type WindowBarPage,
  type WindowBarSettings,
  type WindowBarStyle,
} from 'src/lib/window-bar';
import { WindowBarPreviewStage } from 'src/components/WindowBarPreviewStage';
import type { StylePreset } from 'src/types';

const BACKGROUND_TYPES: Exclude<BackgroundType, 'blur'>[] = ['wallpaper', 'gradient', 'solid'];

type Props = {
  style: ScreenshotStyle;
  presets: StylePreset[];
  /** What the bar's text starts as: the captured window's title, or a placeholder. */
  windowBarText: string;
  /** The capture itself, for the window bar's hover previews. */
  captureImage: string;
  /** The captured page (address and title), as the export's bar reads it. */
  capturePage: WindowBarPage | null;
  /** `group`: changes sharing one (a slider drag, one colour pick) undo as a single step. */
  onChange: (style: ScreenshotStyle, group?: string) => void;
};

let groupCounter = 0;
const nextGroup = (name: string) => `${name}-${++groupCounter}`;

export const ScreenshotStylePanel = ({
  style,
  presets,
  onChange,
  windowBarText,
  captureImage,
  capturePage,
}: Props) => {
  const { t } = useTranslation('screenshot');
  const { t: tFrame } = useTranslation('frame');
  const solidInputRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<string | undefined>(undefined);
  const { background } = style;
  // The bar as it is; a None bar keeps its theme and words for when a style is picked.
  const windowBar: WindowBarSettings = {
    ...DEFAULT_WINDOW_BAR,
    center: 'custom',
    customText: windowBarText,
    ...style.windowBar,
    style: activeBarStyle(style.windowBar),
  };
  const preview = usePreviewCard();
  const previewStyle = (barStyle: WindowBarStyle) =>
    preview.bind(`window-bar-${barStyle}`, () => (
      <PreviewCardBody
        preview={
          <WindowBarPreviewStage
            settings={{ ...windowBar, style: barStyle }}
            background={background}
            still={captureImage}
            page={capturePage}
          />
        }
        title={tFrame(`windowStyle.${barStyle}`)}
        description={tFrame(`windowPreview.${barStyle}`)}
        badge={windowBar.style === barStyle ? tFrame('windowCurrent') : undefined}
      />
    ));

  const patchBackground = (patch: Partial<BackgroundSettings>, group?: string) =>
    onChange({ ...style, background: { ...background, ...patch } }, group);

  /** Props that fold one slider drag into one undo step. */
  const dragGroup = (name: string) => ({
    onPointerDown: () => {
      groupRef.current = nextGroup(name);
    },
    onValueCommit: () => {
      groupRef.current = undefined;
    },
  });

  /** A wallpaper tile, or the studio's own wall (index null). */
  const pickWallpaper = (index: number | null) =>
    onChange({
      ...style,
      background: index === null ? background : { ...background, wallpaperSeed: index },
      ...(style.studio ? { studio: { ...style.studio, studioWall: index === null } } : {}),
    });

  const backgroundLabel = (type: Exclude<BackgroundType, 'blur'>) =>
    type === 'gradient' ? t('gradient') : tFrame(type);

  const studio = style.studio ?? FLAT_STUDIO;
  const studioWall = studio.lookId !== null && studio.studioWall === true;
  const wallpaperTile = (selected: boolean) =>
    cn(
      'cursor-pointer overflow-hidden rounded-md border p-0 transition-all active:scale-[0.95]',
      selected
        ? 'border-sf-border-lt ring-1 ring-sf-border-lt'
        : 'border-sf-border opacity-65 hover:opacity-90',
    );
  const moved =
    studio.offset.x !== 0 ||
    studio.offset.y !== 0 ||
    studio.depth !== 0 ||
    studio.orbit.x !== 0 ||
    studio.orbit.y !== 0 ||
    studio.zoom !== 1 ||
    studio.focus !== null ||
    studio.focusRange !== 0 ||
    studio.lightPower !== 1 ||
    studio.blur !== null ||
    studio.lightSize !== null ||
    studio.light !== null;

  const aspectRatio = (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium text-sf-secondary">{t('aspectRatio')}</div>
      <Select
        value={style.aspectRatioId}
        onValueChange={(aspectRatioId) => onChange({ ...style, aspectRatioId })}
      >
        <SelectTrigger className="w-full" aria-label={t('aspectRatio')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ASPECT_RATIO_PRESETS.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {preset.id === 'original' ? t('original') : preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  // The backdrop, as in the recorder's frame: a wallpaper, a gradient or a colour. In the studio it
  // is the wall behind the screenshot.
  const backgroundSection = (
    <div className="flex flex-col gap-3 border-t border-sf-border pt-4">
      <div className={WIDGET_SECTION_HEADING_CLASS}>{tFrame('background')}</div>
      <ToggleGroup
        type="single"
        size="sm"
        value={background.type}
        onValueChange={(value) => {
          if (value) {
            patchBackground({ type: value as BackgroundType });
          }
        }}
        className="w-full"
      >
        {BACKGROUND_TYPES.map((type) => (
          <ToggleGroupItem key={type} value={type} className="flex-1 text-md">
            {backgroundLabel(type)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {background.type === 'wallpaper' && (
        <div className="grid grid-cols-5 gap-1.5">
          {studio.lookId !== null && (
            <button
              type="button"
              title={t('studioWall')}
              aria-label={t('studioWall')}
              aria-pressed={studioWall}
              className={wallpaperTile(studioWall)}
              style={{
                aspectRatio: '1',
                background: 'radial-gradient(circle at 50% 40%, #2a2c31 0%, #030304 78%)',
              }}
              onClick={() => pickWallpaper(null)}
            />
          )}
          {WALLPAPER_PRESETS.map((preset, index) => (
            <button
              key={preset.id}
              type="button"
              title={preset.label}
              aria-label={preset.label}
              aria-pressed={!studioWall && background.wallpaperSeed === index}
              className={wallpaperTile(!studioWall && background.wallpaperSeed === index)}
              style={{ aspectRatio: '1' }}
              onClick={() => pickWallpaper(index)}
            >
              <img
                src={preset.url}
                alt=""
                className="h-full w-full object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}

      {background.type === 'gradient' && (
        <div className="grid grid-cols-5 gap-1.5">
          {GRADIENT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.label}
              aria-label={preset.label}
              aria-pressed={background.gradientPresetId === preset.id}
              className={cn(
                'cursor-pointer rounded-md border-2 transition-all active:scale-[0.95]',
                background.gradientPresetId === preset.id
                  ? 'border-sf-border-lt'
                  : 'border-transparent hover:border-sf-border-lt',
              )}
              style={{
                aspectRatio: '1',
                background: `linear-gradient(${preset.angle}deg, ${preset.stops
                  .map((stop) => `${stop.color} ${stop.offset * 100}%`)
                  .join(', ')})`,
              }}
              onClick={() => patchBackground({ gradientPresetId: preset.id })}
            />
          ))}
        </div>
      )}

      {background.type === 'solid' && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              groupRef.current = nextGroup('solid-color');
              solidInputRef.current?.click();
            }}
            className="h-10 w-10 rounded-md border border-sf-border p-0 shadow-none hover:border-sf-border-lt hover:bg-transparent"
            style={{ background: background.solidColor }}
            title={tFrame('pickColor')}
            aria-label={tFrame('pickColor')}
          />
          <input
            ref={solidInputRef}
            type="color"
            value={background.solidColor}
            onChange={(event) =>
              patchBackground({ solidColor: event.target.value }, groupRef.current)
            }
            className="sr-only"
          />
        </div>
      )}
    </div>
  );

  // Padding, corner radius and shadow. In the studio the shadow is one strength (its softness is the
  // light's), so only the flat frame shows the blur and the opacity apart.
  const frameSliders = (studioMode: boolean) => (
    <div className="flex flex-col gap-4 border-t border-sf-border pt-4">
      <Slider
        min={0}
        max={40}
        step={1}
        inlineLabel={tFrame('padding')}
        valueLabel={`${Math.round(background.padding * 100)}%`}
        value={[Math.round(background.padding * 100)]}
        {...dragGroup('padding')}
        onValueChange={([value]) => patchBackground({ padding: value / 100 }, groupRef.current)}
      />
      <Slider
        min={0}
        max={40}
        step={1}
        inlineLabel={tFrame('cornerRadius')}
        valueLabel={`${background.cornerRadius}px`}
        value={[background.cornerRadius]}
        {...dragGroup('cornerRadius')}
        onValueChange={([value]) => patchBackground({ cornerRadius: value }, groupRef.current)}
      />
      {studioMode ? (
        <Slider
          min={0}
          max={100}
          step={1}
          inlineLabel={tFrame('shadow')}
          valueLabel={`${Math.round(background.shadowOpacity * 100)}%`}
          value={[Math.round(background.shadowOpacity * 100)]}
          {...dragGroup('shadowOpacity')}
          onValueChange={([value]) =>
            patchBackground({ shadowOpacity: value / 100 }, groupRef.current)
          }
        />
      ) : (
        <>
          <Slider
            min={0}
            max={80}
            step={1}
            inlineLabel={tFrame('shadow')}
            valueLabel={`${background.shadowBlur}px`}
            value={[background.shadowBlur]}
            {...dragGroup('shadowBlur')}
            onValueChange={([value]) => patchBackground({ shadowBlur: value }, groupRef.current)}
          />
          <Slider
            min={0}
            max={100}
            step={1}
            inlineLabel={tFrame('opacity')}
            valueLabel={`${Math.round(background.shadowOpacity * 100)}%`}
            value={[Math.round(background.shadowOpacity * 100)]}
            {...dragGroup('shadowOpacity')}
            onValueChange={([value]) =>
              patchBackground({ shadowOpacity: value / 100 }, groupRef.current)
            }
          />
        </>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {studio.lookId !== null && (
        <>
          {aspectRatio}
          {backgroundSection}
          {frameSliders(true)}
          <div className="flex flex-col gap-3 border-t border-sf-border pt-4">
            <p className="text-xs leading-relaxed text-sf-muted">{t('studioHint')}</p>
            {moved && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  onChange({
                    ...style,
                    studio: {
                      ...FLAT_STUDIO,
                      lookId: studio.lookId,
                      studioWall: studio.studioWall,
                    },
                  })
                }
              >
                {t('resetPosition')}
              </Button>
            )}
          </div>
        </>
      )}

      {/* The flat frame's controls, window bar included: a look replaces all of them. */}
      {studio.lookId === null && (
        <>
          <div className="flex items-center justify-between">
            <div className={WIDGET_SECTION_HEADING_CLASS}>{t('frame')}</div>
            <Switch
              size="xs"
              checked={style.frameEnabled}
              onCheckedChange={(frameEnabled) => onChange({ ...style, frameEnabled })}
              aria-label={t('frame')}
            >
              <SwitchThumb />
            </Switch>
          </div>

          {style.frameEnabled && (
            <>
              <div className="flex flex-col gap-2">
                <div className="text-xs font-medium text-sf-secondary">{t('stylePreset')}</div>
                <Select
                  value=""
                  disabled={presets.length === 0}
                  onValueChange={(id) => {
                    const preset = presets.find((item) => item.id === id);
                    if (preset) {
                      onChange({
                        ...style,
                        background: { ...preset.background },
                        ...(preset.windowBar && { windowBar: { ...preset.windowBar } }),
                      });
                    }
                  }}
                >
                  <SelectTrigger className="w-full" aria-label={t('stylePreset')}>
                    <SelectValue
                      placeholder={presets.length ? t('choosePreset') : t('noPresets')}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {aspectRatio}

              {backgroundSection}

              {frameSliders(false)}
            </>
          )}

          <div className="flex flex-col gap-4 border-t border-sf-border pt-4">
            <div className={WIDGET_SECTION_HEADING_CLASS}>{tFrame('windowBar')}</div>
            <WindowBarControls
              value={windowBar}
              previewStyle={previewStyle}
              onChange={(_label, patch) =>
                onChange(
                  { ...style, windowBar: { ...windowBar, ...patch, enabled: true } },
                  groupRef.current,
                )
              }
              onTextEditStart={() => {
                groupRef.current = nextGroup('windowText');
              }}
              onTextEditEnd={() => {
                groupRef.current = undefined;
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};
