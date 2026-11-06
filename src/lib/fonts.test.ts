import { describe, expect, it } from 'vitest';
import { BRAND_FONT_FAMILIES, fontStack, PRESET_FONT_FAMILIES } from './fonts';

describe('brand fonts', () => {
  it('maps the three Director brand fonts to families the renderers can draw', () => {
    expect(BRAND_FONT_FAMILIES).toEqual({ sans: 'Inter', serif: 'Georgia', system: 'system-ui' });
  });

  it('offers the brand fonts as preset fonts', () => {
    expect(PRESET_FONT_FAMILIES).toEqual(['Inter', 'Georgia', 'system-ui']);
  });
});

describe('fontStack', () => {
  it('quotes a named family and falls back to sans-serif', () => {
    expect(fontStack('Inter')).toBe('"Inter", ui-sans-serif, system-ui, sans-serif');
    expect(fontStack('Helvetica Neue')).toBe(
      '"Helvetica Neue", ui-sans-serif, system-ui, sans-serif',
    );
  });

  it('falls back to a serif for serif families', () => {
    expect(fontStack('Georgia')).toBe('"Georgia", "Times New Roman", ui-serif, serif');
    expect(fontStack('Playfair Display')).toBe(
      '"Playfair Display", "Times New Roman", ui-serif, serif',
    );
  });

  it('falls back to monospace for monospace families', () => {
    expect(fontStack('JetBrains Mono')).toBe('"JetBrains Mono", ui-monospace, monospace');
    expect(fontStack('Courier New')).toBe('"Courier New", ui-monospace, monospace');
  });

  it('leaves the system font keyword unquoted, so it means the system font', () => {
    expect(fontStack('system-ui')).toBe('system-ui, ui-sans-serif, sans-serif');
  });

  it('copes with a blank or quoted family', () => {
    expect(fontStack('')).toBe('system-ui, ui-sans-serif, sans-serif');
    expect(fontStack('"Inter"')).toBe('"Inter", ui-sans-serif, system-ui, sans-serif');
  });
});
