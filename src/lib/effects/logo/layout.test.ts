import { describe, expect, it } from 'vitest';
import { computeLogoRect, DEFAULT_LOGO_SETTINGS, normalizeLogoSettings } from './layout';

describe('computeLogoRect', () => {
  const logo = { ...DEFAULT_LOGO_SETTINGS, src: 'data:image/png;base64,AA==' };

  it('sizes the logo by canvas width and keeps its aspect ratio', () => {
    const rect = computeLogoRect(1920, 1080, 400, 100, { ...logo, size: 0.1 });
    expect(rect.width).toBeCloseTo(192);
    expect(rect.height).toBeCloseTo(48);
  });

  it('places it in each corner with a margin', () => {
    const settings = { ...logo, size: 0.1 };
    const margin = Math.round(1080 * 0.04);
    expect(computeLogoRect(1920, 1080, 100, 100, { ...settings, corner: 'top-left' })).toEqual({
      x: margin,
      y: margin,
      width: 192,
      height: 192,
    });
    expect(computeLogoRect(1920, 1080, 100, 100, { ...settings, corner: 'top-right' })).toEqual({
      x: 1920 - margin - 192,
      y: margin,
      width: 192,
      height: 192,
    });
    expect(computeLogoRect(1920, 1080, 100, 100, { ...settings, corner: 'bottom-left' })).toEqual({
      x: margin,
      y: 1080 - margin - 192,
      width: 192,
      height: 192,
    });
    expect(computeLogoRect(1920, 1080, 100, 100, { ...settings, corner: 'bottom-right' })).toEqual({
      x: 1920 - margin - 192,
      y: 1080 - margin - 192,
      width: 192,
      height: 192,
    });
  });

  it('keeps a tall logo from growing past a quarter of the canvas height', () => {
    const rect = computeLogoRect(1920, 1080, 100, 1000, { ...logo, size: 0.3 });
    expect(rect.height).toBeCloseTo(270);
    expect(rect.width).toBeCloseTo(27);
  });

  it('treats an image with no size yet as square', () => {
    const rect = computeLogoRect(1000, 1000, 0, 0, { ...logo, size: 0.1 });
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(100);
  });
});

describe('normalizeLogoSettings', () => {
  it('returns null for no logo or one without an image', () => {
    expect(normalizeLogoSettings(undefined)).toBeNull();
    expect(normalizeLogoSettings(null)).toBeNull();
    expect(normalizeLogoSettings({ corner: 'top-left' })).toBeNull();
    expect(normalizeLogoSettings({ src: '' })).toBeNull();
  });

  it('fills defaults and clamps values', () => {
    expect(
      normalizeLogoSettings({ src: 'data:image/png;base64,AA==', size: 5, opacity: -3 }),
    ).toEqual({
      src: 'data:image/png;base64,AA==',
      corner: DEFAULT_LOGO_SETTINGS.corner,
      size: 0.3,
      opacity: 0,
    });
  });

  it('replaces an unknown corner with the default', () => {
    expect(
      normalizeLogoSettings({ src: 'data:image/png;base64,AA==', corner: 'middle' })?.corner,
    ).toBe(DEFAULT_LOGO_SETTINGS.corner);
  });
});
