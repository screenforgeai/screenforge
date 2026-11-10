/**
 * Style presets: loading them (older ones included), applying one to the
 * editor and capturing the editor's style as a new one. Pure, so both the
 * main process and the presets menu use it.
 */
import type { PresetLogo, StylePreset, StylePresetAssets, StylePresetDraft } from '../../types';
import type { AppStore, EditableStorePatch } from '../../store/types';
import { CUSTOM_WALLPAPER_SEED } from '../effects/frame/constants';
import { normalizeLogoPlacement } from '../effects/logo/layout';
import { normalizeCursorClickSound } from '../effects/cursor/audio';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function normalizePresetLogo(raw: unknown): PresetLogo | null {
  if (!isRecord(raw) || !nonEmptyString(raw.path)) {
    return null;
  }
  return { path: raw.path, ...normalizeLogoPlacement(raw) };
}

/**
 * A stored preset, or null when it isn't one. Presets saved before logos,
 * saved wallpapers and fonts come back exactly as they were; a broken new
 * field is dropped rather than the whole preset.
 */
export function normalizeStylePreset(raw: unknown): StylePreset | null {
  if (
    !isRecord(raw) ||
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    !isRecord(raw.background) ||
    !isRecord(raw.cursor) ||
    !isRecord(raw.captionsAppearance)
  ) {
    return null;
  }
  const { source, logo, customWallpaperPath, font, ...rest } = raw;
  const preset = {
    ...rest,
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
  } as unknown as StylePreset;
  if (source === 'director') {
    preset.source = 'director';
  }
  if (logo !== undefined) {
    preset.logo = normalizePresetLogo(logo);
  }
  if (nonEmptyString(customWallpaperPath)) {
    preset.customWallpaperPath = customWallpaperPath;
  }
  if (nonEmptyString(font)) {
    preset.font = font;
  }
  return preset;
}

type StyleState = Pick<
  AppStore,
  | 'frame'
  | 'camera'
  | 'keyboard'
  | 'captions'
  | 'textClips'
  | 'cursorEnabled'
  | 'cursorStyle'
  | 'cursorClickEffect'
  | 'cursorSize'
  | 'cursorHalflife'
  | 'cursorMotionBlur'
  | 'cursorMaxTilt'
  | 'cursorHideWhenIdle'
  | 'cursorIdleHideSeconds'
  | 'cursorClickSound'
  | 'cursorClickSoundVolume'
  | 'cursorContinuousTracking'
>;

function logoPatch(
  state: StyleState,
  preset: StylePreset,
  assets: StylePresetAssets,
): StyleState['frame']['logo'] {
  if (preset.logo === undefined) {
    return state.frame.logo;
  }
  if (preset.logo === null) {
    return null;
  }
  if (!assets.logoDataUrl) {
    // The image couldn't be read; don't take away a logo the project has.
    return state.frame.logo;
  }
  return {
    src: assets.logoDataUrl,
    corner: preset.logo.corner,
    size: preset.logo.size,
    opacity: preset.logo.opacity,
  };
}

/** The undoable edit that applies a preset; images come pre-loaded in `assets`. */
export function stylePresetPatch(
  state: StyleState,
  preset: StylePreset,
  assets: StylePresetAssets,
): EditableStorePatch {
  const appearance = preset.captionsAppearance;
  const logo = logoPatch(state, preset, assets);
  const patch: EditableStorePatch = {
    frame: { ...state.frame, background: { ...preset.background }, logo },
    cursorEnabled: preset.cursor.enabled,
    cursorStyle: preset.cursor.style,
    cursorClickEffect: preset.cursor.clickEffect,
    cursorSize: preset.cursor.size,
    cursorHalflife: preset.cursor.halflife,
    cursorMotionBlur: preset.cursor.motionBlur,
    cursorMaxTilt: preset.cursor.maxTilt,
    cursorHideWhenIdle: preset.cursor.hideWhenIdle,
    cursorIdleHideSeconds: preset.cursor.idleHideSeconds,
    // Presets saved before the click-sound picker name sounds it no longer has.
    cursorClickSound: normalizeCursorClickSound(preset.cursor.clickSound),
    cursorClickSoundVolume: preset.cursor.clickSoundVolume,
    cursorContinuousTracking: preset.cursor.continuousTracking,
    captions: {
      ...state.captions,
      fontFamily: preset.font ?? appearance.fontFamily,
      fontScale: appearance.fontScale,
      bold: appearance.bold,
      italic: appearance.italic,
      textColor: appearance.textColor,
      highlightColor: appearance.highlightColor,
      textOpacity: appearance.textOpacity,
      backgroundEnabled: appearance.backgroundEnabled,
      backgroundColor: appearance.backgroundColor,
      backgroundOpacity: appearance.backgroundOpacity,
      backgroundRadius: appearance.backgroundRadius,
      position: appearance.position,
    },
  };
  if (preset.camera) {
    patch.camera = {
      ...preset.camera,
      enabled: state.camera.enabled,
      zoomRadiusScale: preset.camera.zoomRadiusScale ?? 1.0,
    };
  }
  if (preset.keyboard) {
    patch.keyboard = preset.keyboard;
  }
  if (preset.font) {
    const font = preset.font;
    patch.textClips = state.textClips.map((clip) => ({ ...clip, fontFamily: font }));
  }
  return patch;
}

export interface PresetDraftOptions {
  name: string;
  /** A font for captions and text clips, or null to leave fonts out. */
  font: string | null;
  /** The custom wallpaper image, saved only when it is the wallpaper in use. */
  customWallpaperDataUrl: string | null;
}

/** The editor's current style as a new preset. */
export function presetDraftFromState(
  state: StyleState,
  { name, font, customWallpaperDataUrl }: PresetDraftOptions,
): StylePresetDraft {
  const { captions, frame } = state;
  const usesCustomWallpaper =
    frame.background.type === 'wallpaper' &&
    frame.background.wallpaperSeed === CUSTOM_WALLPAPER_SEED;
  return {
    name,
    background: { ...frame.background },
    cursor: {
      enabled: state.cursorEnabled,
      style: state.cursorStyle,
      clickEffect: state.cursorClickEffect,
      size: state.cursorSize,
      halflife: state.cursorHalflife,
      motionBlur: state.cursorMotionBlur,
      maxTilt: state.cursorMaxTilt,
      hideWhenIdle: state.cursorHideWhenIdle,
      idleHideSeconds: state.cursorIdleHideSeconds,
      clickSound: state.cursorClickSound,
      clickSoundVolume: state.cursorClickSoundVolume,
      continuousTracking: state.cursorContinuousTracking,
    },
    camera: state.camera,
    keyboard: state.keyboard,
    captionsAppearance: {
      fontFamily: captions.fontFamily,
      fontScale: captions.fontScale,
      bold: captions.bold,
      italic: captions.italic,
      textColor: captions.textColor,
      highlightColor: captions.highlightColor,
      textOpacity: captions.textOpacity,
      backgroundEnabled: captions.backgroundEnabled,
      backgroundColor: captions.backgroundColor,
      backgroundOpacity: captions.backgroundOpacity,
      backgroundRadius: captions.backgroundRadius,
      position: captions.position,
    },
    logo: frame.logo
      ? {
          dataUrl: frame.logo.src,
          corner: frame.logo.corner,
          size: frame.logo.size,
          opacity: frame.logo.opacity,
        }
      : null,
    customWallpaperDataUrl: usesCustomWallpaper ? customWallpaperDataUrl : null,
    font,
  };
}
