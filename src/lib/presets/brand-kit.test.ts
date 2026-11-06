import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKGROUND } from '../effects/frame/analyze';
import { DEFAULT_CAPTION_APPEARANCE, DEFAULT_CURSOR_SETTINGS } from '../../store/defaults';
import type { DirectorBrandKit } from '../../types';
import { BRAND_KIT_PRESET_ID, brandKitToPreset } from './brand-kit';

const KIT: DirectorBrandKit = {
  logoUrl: 'https://storage.example.com/logo.png?sig=abc',
  accent: '#c2410c',
  accentDark: '#fb923c',
  font: 'serif',
  captions: {
    position: 'top',
    textColor: '#fafafa',
    backgroundColor: '#111111',
    backgroundOpacity: 70,
    highlightWithAccent: true,
  },
  background: {
    ...DEFAULT_BACKGROUND,
    type: 'gradient',
    gradientFrom: '#123456',
    gradientTo: '#654321',
    wallpaperSeed: 7,
  },
  cursor: { ...DEFAULT_CURSOR_SETTINGS, size: 150, clickEffect: 'ripple' },
  defaultPresetId: null,
};

const OPTS = { name: 'Acme', savedAt: '2026-11-06T10:00:00.000Z', logoPath: '/ud/logo.png' };

describe('brandKitToPreset', () => {
  it('makes a read-only workspace preset with a stable id', () => {
    const preset = brandKitToPreset(KIT, OPTS);
    expect(preset.id).toBe(BRAND_KIT_PRESET_ID);
    expect(preset.source).toBe('director');
    expect(preset.name).toBe('Acme');
    expect(preset.savedAt).toBe(OPTS.savedAt);
  });

  it('takes background and cursor as they are, wallpaper seed included', () => {
    const preset = brandKitToPreset(KIT, OPTS);
    expect(preset.background).toEqual(KIT.background);
    expect(preset.cursor).toEqual(KIT.cursor);
  });

  it('falls back to the default background and cursor when the kit has none', () => {
    const preset = brandKitToPreset({ ...KIT, background: null, cursor: null }, OPTS);
    expect(preset.background).toEqual(DEFAULT_BACKGROUND);
    expect(preset.cursor).toEqual(DEFAULT_CURSOR_SETTINGS);
  });

  it('ignores unknown or mistyped background and cursor fields', () => {
    const preset = brandKitToPreset(
      {
        ...KIT,
        background: { padding: 'lots', cornerRadius: 20, extra: 1 } as never,
        cursor: { size: 140, enabled: 'yes' } as never,
      },
      OPTS,
    );
    expect(preset.background).toEqual({ ...DEFAULT_BACKGROUND, cornerRadius: 20 });
    expect(preset.cursor).toEqual({ ...DEFAULT_CURSOR_SETTINGS, size: 140 });
  });

  it('maps the caption style', () => {
    expect(brandKitToPreset(KIT, OPTS).captionsAppearance).toEqual({
      ...DEFAULT_CAPTION_APPEARANCE,
      fontFamily: 'Georgia',
      position: 'top',
      textColor: '#fafafa',
      backgroundColor: '#111111',
      backgroundOpacity: 70,
      backgroundEnabled: true,
      highlightColor: '#c2410c',
    });
  });

  it('highlights with the text colour when the accent is off, and drops a 0% background', () => {
    const captions = brandKitToPreset(
      {
        ...KIT,
        captions: { ...KIT.captions, backgroundOpacity: 0, highlightWithAccent: false },
      },
      OPTS,
    ).captionsAppearance;
    expect(captions.highlightColor).toBe('#fafafa');
    expect(captions.backgroundEnabled).toBe(false);
    expect(captions.backgroundOpacity).toBe(0);
  });

  it('keeps bad colours and opacities from reaching the renderers', () => {
    const captions = brandKitToPreset(
      {
        ...KIT,
        accent: 'red',
        captions: {
          position: 'middle' as never,
          textColor: 'url(x)',
          backgroundColor: '#12345',
          backgroundOpacity: 250,
          highlightWithAccent: true,
        },
      },
      OPTS,
    ).captionsAppearance;
    expect(captions.textColor).toBe(DEFAULT_CAPTION_APPEARANCE.textColor);
    expect(captions.backgroundColor).toBe(DEFAULT_CAPTION_APPEARANCE.backgroundColor);
    expect(captions.highlightColor).toBe(DEFAULT_CAPTION_APPEARANCE.textColor);
    expect(captions.backgroundOpacity).toBe(100);
    expect(captions.position).toBe('bottom');
  });

  it('maps each brand font to a font family, for captions and the preset font', () => {
    for (const [font, family] of [
      ['sans', 'Inter'],
      ['serif', 'Georgia'],
      ['system', 'system-ui'],
    ] as const) {
      const preset = brandKitToPreset({ ...KIT, font }, OPTS);
      expect(preset.font).toBe(family);
      expect(preset.captionsAppearance.fontFamily).toBe(family);
    }
    expect(brandKitToPreset({ ...KIT, font: 'comic' as never }, OPTS).font).toBe('system-ui');
  });

  it('adds the downloaded logo, or none', () => {
    expect(brandKitToPreset(KIT, OPTS).logo).toEqual({
      path: '/ud/logo.png',
      corner: 'bottom-right',
      size: 0.1,
      opacity: 100,
    });
    expect(brandKitToPreset(KIT, { ...OPTS, logoPath: null }).logo).toBeNull();
  });

  it('leaves camera and keyboard settings alone', () => {
    const preset = brandKitToPreset(KIT, OPTS);
    expect(preset.camera).toBeUndefined();
    expect(preset.keyboard).toBeUndefined();
  });
});
