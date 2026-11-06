/**
 * Fonts shared by captions, text clips and style presets.
 *
 * Director's brand kit names one of three fonts; each maps to a family the
 * caption and text renderers can draw (Inter is Director's own sans).
 */
export type BrandFont = 'sans' | 'serif' | 'system';

export const BRAND_FONT_FAMILIES: Record<BrandFont, string> = {
  sans: 'Inter',
  serif: 'Georgia',
  system: 'system-ui',
};

/** Fonts a style preset can set, in menu order. */
export const PRESET_FONT_FAMILIES: string[] = [
  BRAND_FONT_FAMILIES.sans,
  BRAND_FONT_FAMILIES.serif,
  BRAND_FONT_FAMILIES.system,
];

const SERIF_FAMILIES = new Set(['georgia', 'playfair display', 'times new roman', 'times']);
const MONOSPACE_FAMILIES = new Set(['jetbrains mono', 'courier new', 'courier', 'menlo']);
const GENERIC_FAMILIES = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'cursive']);

/**
 * A CSS font-family list for one family: the family quoted (generic keywords
 * like system-ui stay bare, so they keep their meaning) and a fallback of
 * the same kind, so a missing serif still draws as a serif.
 */
export function fontStack(family: string): string {
  const name = family.trim().replace(/^["']|["']$/g, '') || 'system-ui';
  const key = name.toLowerCase();
  if (GENERIC_FAMILIES.has(key)) {
    return `${key}, ui-sans-serif, sans-serif`;
  }
  if (SERIF_FAMILIES.has(key)) {
    return `"${name}", "Times New Roman", ui-serif, serif`;
  }
  if (MONOSPACE_FAMILIES.has(key)) {
    return `"${name}", ui-monospace, monospace`;
  }
  return `"${name}", ui-sans-serif, system-ui, sans-serif`;
}
