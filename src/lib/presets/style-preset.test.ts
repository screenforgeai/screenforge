import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKGROUND, DEFAULT_FRAME } from '../effects/frame/analyze';
import {
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_CAPTION_APPEARANCE,
  DEFAULT_CURSOR_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
} from '../../store/defaults';
import type { CaptionSettings, StylePreset, StylePresetAssets, TextClip } from '../../types';
import { normalizeStylePreset, presetDraftFromState, stylePresetPatch } from './style-preset';

// A preset as saved before logos, saved wallpapers and fonts existed.
const OLD_PRESET: StylePreset = {
  id: 'preset_1',
  name: 'Dark Studio',
  savedAt: '2026-01-01T00:00:00.000Z',
  background: { ...DEFAULT_BACKGROUND, wallpaperSeed: 3 },
  cursor: { ...DEFAULT_CURSOR_SETTINGS, size: 140 },
  camera: { ...DEFAULT_CAMERA_SETTINGS, enabled: true, size: 0.3 },
  keyboard: { ...DEFAULT_KEYBOARD_SETTINGS, size: 'large' },
  captionsAppearance: { ...DEFAULT_CAPTION_APPEARANCE, fontFamily: 'Inter', position: 'top' },
};

const CAPTIONS: CaptionSettings = {
  segments: [],
  model: 'base',
  language: 'en',
  captionsEnabled: true,
  ...DEFAULT_CAPTION_APPEARANCE,
};

const textClip = (id: string, fontFamily: string): TextClip =>
  ({ id, start: 0, end: 1, content: 'Hi', fontFamily }) as TextClip;

const LOGO_SRC = 'data:image/png;base64,iVBORw0KGgo=';

const state = (overrides: Record<string, unknown> = {}) => ({
  frame: { ...DEFAULT_FRAME },
  camera: { ...DEFAULT_CAMERA_SETTINGS, enabled: false, size: 0.15 },
  keyboard: DEFAULT_KEYBOARD_SETTINGS,
  captions: CAPTIONS,
  textClips: [textClip('t1', 'Geist')],
  cursorEnabled: true,
  cursorStyle: 'cursor01' as const,
  cursorClickEffect: 'none' as const,
  cursorSize: 125,
  cursorHalflife: 0.06,
  cursorMotionBlur: true,
  cursorMaxTilt: 4,
  cursorHideWhenIdle: false,
  cursorIdleHideSeconds: 5,
  cursorClickSound: 'none' as const,
  cursorClickSoundVolume: DEFAULT_CURSOR_SETTINGS.clickSoundVolume,
  cursorContinuousTracking: true,
  ...overrides,
});

const NO_ASSETS: StylePresetAssets = { logoDataUrl: null, customWallpaperDataUrl: null };

describe('normalizeStylePreset', () => {
  it('loads an old preset unchanged', () => {
    expect(normalizeStylePreset(JSON.parse(JSON.stringify(OLD_PRESET)))).toEqual(OLD_PRESET);
  });

  it('rejects things that are not presets', () => {
    expect(normalizeStylePreset(null)).toBeNull();
    expect(normalizeStylePreset({ id: 'x' })).toBeNull();
    expect(normalizeStylePreset({ ...OLD_PRESET, id: 3 })).toBeNull();
  });

  it('keeps a valid logo, wallpaper path and font', () => {
    const preset = {
      ...OLD_PRESET,
      logo: { path: '/ud/preset-assets/p/logo.png', corner: 'top-left', size: 0.2, opacity: 80 },
      customWallpaperPath: '/ud/preset-assets/p/wallpaper.jpg',
      font: 'Georgia',
    };
    expect(normalizeStylePreset(preset)).toEqual(preset);
  });

  it('drops a broken logo, path or font rather than the whole preset', () => {
    const normalized = normalizeStylePreset({
      ...OLD_PRESET,
      logo: { corner: 'top-left' },
      customWallpaperPath: 42,
      font: '',
    });
    expect(normalized).toEqual({ ...OLD_PRESET, logo: null });
  });

  it('fills a logo with defaults and keeps the workspace source', () => {
    const normalized = normalizeStylePreset({
      ...OLD_PRESET,
      source: 'director',
      logo: { path: '/l.png' },
    });
    expect(normalized?.source).toBe('director');
    expect(normalized?.logo).toEqual({
      path: '/l.png',
      corner: 'bottom-right',
      size: 0.1,
      opacity: 100,
    });
    expect(normalizeStylePreset({ ...OLD_PRESET, source: 'elsewhere' })?.source).toBeUndefined();
  });
});

describe('stylePresetPatch', () => {
  it('maps a click sound saved before the click-sound picker to its new name', () => {
    const legacy = {
      ...OLD_PRESET,
      cursor: { ...OLD_PRESET.cursor, clickSound: 'magic-mouse' },
    } as unknown as StylePreset;
    expect(stylePresetPatch(state(), legacy, NO_ASSETS).cursorClickSound).toBe('trackpad');
  });

  it('applies an old preset as before and leaves the logo and text clips alone', () => {
    const current = state({
      frame: {
        ...DEFAULT_FRAME,
        logo: { src: LOGO_SRC, corner: 'top-left', size: 0.1, opacity: 50 },
      },
    });
    const patch = stylePresetPatch(current, OLD_PRESET, NO_ASSETS);
    expect(patch.frame).toEqual({ ...current.frame, background: OLD_PRESET.background });
    expect(patch.cursorSize).toBe(140);
    expect(patch.camera).toEqual({ ...OLD_PRESET.camera, enabled: false });
    expect(patch.keyboard).toEqual(OLD_PRESET.keyboard);
    expect(patch.captions).toEqual({ ...CAPTIONS, fontFamily: 'Inter', position: 'top' });
    expect(patch.textClips).toBeUndefined();
  });

  it('adds the preset logo from its loaded image', () => {
    const preset = {
      ...OLD_PRESET,
      logo: { path: '/l.png', corner: 'top-right' as const, size: 0.15, opacity: 90 },
    };
    const patch = stylePresetPatch(state(), preset, { ...NO_ASSETS, logoDataUrl: LOGO_SRC });
    expect(patch.frame?.logo).toEqual({
      src: LOGO_SRC,
      corner: 'top-right',
      size: 0.15,
      opacity: 90,
    });
  });

  it('removes the logo for a preset saved without one', () => {
    const current = state({
      frame: {
        ...DEFAULT_FRAME,
        logo: { src: LOGO_SRC, corner: 'top-left', size: 0.1, opacity: 50 },
      },
    });
    expect(stylePresetPatch(current, { ...OLD_PRESET, logo: null }, NO_ASSETS).frame?.logo).toBe(
      null,
    );
  });

  it('keeps the current logo when the preset logo image could not be read', () => {
    const logo = { src: LOGO_SRC, corner: 'top-left' as const, size: 0.1, opacity: 50 };
    const preset = {
      ...OLD_PRESET,
      logo: { path: '/gone.png', corner: 'top-right' as const, size: 0.15, opacity: 90 },
    };
    const patch = stylePresetPatch(state({ frame: { ...DEFAULT_FRAME, logo } }), preset, NO_ASSETS);
    expect(patch.frame?.logo).toEqual(logo);
  });

  it('sets the preset font on captions and text clips', () => {
    const patch = stylePresetPatch(state(), { ...OLD_PRESET, font: 'Georgia' }, NO_ASSETS);
    expect(patch.captions?.fontFamily).toBe('Georgia');
    expect(patch.textClips).toEqual([textClip('t1', 'Georgia')]);
  });

  it('leaves camera and keyboard alone for a preset without them', () => {
    const brandKit: StylePreset = { ...OLD_PRESET, camera: undefined, keyboard: undefined };
    const patch = stylePresetPatch(state(), brandKit, NO_ASSETS);
    expect(patch.camera).toBeUndefined();
    expect(patch.keyboard).toBeUndefined();
  });
});

describe('presetDraftFromState', () => {
  it('captures the current style, its logo and custom wallpaper', () => {
    const logo = { src: LOGO_SRC, corner: 'top-left' as const, size: 0.12, opacity: 70 };
    const draft = presetDraftFromState(
      state({
        frame: { ...DEFAULT_FRAME, background: { ...DEFAULT_BACKGROUND, wallpaperSeed: -1 }, logo },
      }),
      { name: 'Launch', font: 'Inter', customWallpaperDataUrl: 'data:image/jpeg;base64,/9j/' },
    );
    expect(draft).toMatchObject({
      name: 'Launch',
      font: 'Inter',
      logo: { dataUrl: LOGO_SRC, corner: 'top-left', size: 0.12, opacity: 70 },
      customWallpaperDataUrl: 'data:image/jpeg;base64,/9j/',
      background: { ...DEFAULT_BACKGROUND, wallpaperSeed: -1 },
      cursor: DEFAULT_CURSOR_SETTINGS,
    });
    expect(draft.captionsAppearance).toEqual(DEFAULT_CAPTION_APPEARANCE);
  });

  it('saves no wallpaper image unless the custom wallpaper is in use', () => {
    const draft = presetDraftFromState(state(), {
      name: 'Plain',
      font: null,
      customWallpaperDataUrl: 'data:image/jpeg;base64,/9j/',
    });
    expect(draft.customWallpaperDataUrl).toBeNull();
    expect(draft.logo).toBeNull();
    expect(draft.font).toBeNull();
  });
});
