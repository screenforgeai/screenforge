/**
 * Director's workspace brand kit as a Screenforge style preset
 * (screenforgeai/screenforge#27). Pure: the main process downloads the kit
 * and its logo, then maps it here.
 */
import type {
  CaptionAppearance,
  CaptionPosition,
  DirectorBrandKit,
  StylePreset,
} from '../../types';
import { DEFAULT_BACKGROUND } from '../effects/frame/analyze';
import { DEFAULT_LOGO_SETTINGS } from '../effects/logo/layout';
import { BRAND_FONT_FAMILIES, type BrandFont } from '../fonts';
import { DEFAULT_CAPTION_APPEARANCE, DEFAULT_CURSOR_SETTINGS } from '../../store/defaults';

/** The brand kit preset's id: stable, so it stays in place as it re-syncs. */
export const BRAND_KIT_PRESET_ID = 'director-brand-kit';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const colorOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;

/**
 * Director sends the same shapes as Screenforge's own settings; still, only
 * known keys with the expected type get through, over the defaults.
 */
function mergeKnown<T extends object>(defaults: T, raw: unknown): T {
  if (!raw || typeof raw !== 'object') {
    return { ...defaults };
  }
  const result = { ...defaults } as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = (raw as Record<string, unknown>)[key];
    if (
      typeof value === typeof fallback &&
      value !== null &&
      (typeof value !== 'number' || Number.isFinite(value))
    ) {
      result[key] = value;
    }
  }
  return result as T;
}

export function brandFontFamily(font: unknown): string {
  return Object.prototype.hasOwnProperty.call(BRAND_FONT_FAMILIES, font as string)
    ? BRAND_FONT_FAMILIES[font as BrandFont]
    : BRAND_FONT_FAMILIES.system;
}

function captionsFromBrandKit(kit: DirectorBrandKit, fontFamily: string): CaptionAppearance {
  const captions = (kit.captions ?? {}) as Partial<DirectorBrandKit['captions']>;
  const textColor = colorOr(captions.textColor, DEFAULT_CAPTION_APPEARANCE.textColor);
  const rawOpacity = Number(captions.backgroundOpacity);
  const backgroundOpacity = Number.isFinite(rawOpacity)
    ? Math.min(100, Math.max(0, Math.round(rawOpacity)))
    : DEFAULT_CAPTION_APPEARANCE.backgroundOpacity;
  const position: CaptionPosition = captions.position === 'top' ? 'top' : 'bottom';
  return {
    ...DEFAULT_CAPTION_APPEARANCE,
    fontFamily,
    position,
    textColor,
    backgroundColor: colorOr(captions.backgroundColor, DEFAULT_CAPTION_APPEARANCE.backgroundColor),
    backgroundOpacity,
    backgroundEnabled: backgroundOpacity > 0,
    highlightColor: captions.highlightWithAccent ? colorOr(kit.accent, textColor) : textColor,
  };
}

export interface BrandKitPresetOptions {
  /** Shown in the presets menu next to "Brand kit"; the workspace name. */
  name: string;
  savedAt: string;
  /** The downloaded logo in the preset assets folder, or null for none. */
  logoPath: string | null;
}

/**
 * Background and cursor come over as they are; the caption style and font
 * become the caption appearance and the preset font. Director has no camera
 * or keyboard settings, so the preset leaves those alone.
 */
export function brandKitToPreset(
  kit: DirectorBrandKit,
  { name, savedAt, logoPath }: BrandKitPresetOptions,
): StylePreset {
  const font = brandFontFamily(kit.font);
  return {
    id: BRAND_KIT_PRESET_ID,
    name,
    savedAt,
    source: 'director',
    background: mergeKnown(DEFAULT_BACKGROUND, kit.background),
    cursor: mergeKnown(DEFAULT_CURSOR_SETTINGS, kit.cursor),
    captionsAppearance: captionsFromBrandKit(kit, font),
    font,
    logo: logoPath ? { path: logoPath, ...DEFAULT_LOGO_SETTINGS } : null,
  };
}
