import { describe, expect, it } from 'vitest';
import {
  CURSOR_COLOR_OPTIONS,
  CURSOR_STYLE_GROUPS,
  CURSOR_STYLE_IDS,
  DEFAULT_CURSOR_COLOR,
  getCursorStyleExtent,
  getPointerAxis,
  isAnimatedCursorStyle,
  isNameTagCursorStyle,
  normalizeCursorColor,
  normalizeCursorLabel,
  normalizeCursorStyle,
} from './styles';
import { CURSOR_PREVIEW_STATES, CURSOR_REGISTRY } from './cursors';

describe('cursor style list', () => {
  it('groups every style exactly once, standard first', () => {
    const grouped = CURSOR_STYLE_GROUPS.flatMap((group) => group.styles);
    expect([...grouped].sort()).toEqual([...CURSOR_STYLE_IDS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(CURSOR_STYLE_GROUPS.map((group) => group.id)).toEqual([
      'standard',
      'modern',
      'decorative',
    ]);
    expect(CURSOR_STYLE_GROUPS[0].styles[0]).toBe('cursor01');
  });

  it('registers arrow, hand and text for every style', () => {
    for (const id of CURSOR_STYLE_IDS) {
      const definition = CURSOR_REGISTRY[id];
      expect(definition, id).toBeDefined();
      for (const state of CURSOR_PREVIEW_STATES) {
        expect(typeof definition.states[state].draw, `${id}.${state}`).toBe('function');
      }
    }
  });

  it('gives the collaborator and rounded styles a name tag', () => {
    expect(CURSOR_STYLE_IDS.filter(isNameTagCursorStyle)).toEqual(['collaborator', 'rounded']);
  });

  it('only animates the glitter and sparkle styles', () => {
    expect(CURSOR_STYLE_IDS.filter(isAnimatedCursorStyle)).toEqual(['glitter', 'sparkle']);
  });
});

describe('saved cursor values', () => {
  it('keeps known styles and falls back to the macOS cursor for anything else', () => {
    expect(normalizeCursorStyle('glass')).toBe('glass');
    expect(normalizeCursorStyle('cursor99')).toBe('cursor01');
    expect(normalizeCursorStyle(undefined)).toBe('cursor01');
  });

  it('starts name-tag cursors in sky blue', () => {
    expect(DEFAULT_CURSOR_COLOR).toBe('#1D9BF0');
    expect(CURSOR_COLOR_OPTIONS[0]).toBe('#1D9BF0');
  });

  it('keeps palette colours and falls back to the first one', () => {
    expect(normalizeCursorColor(CURSOR_COLOR_OPTIONS[2])).toBe(CURSOR_COLOR_OPTIONS[2]);
    expect(normalizeCursorColor('red')).toBe(CURSOR_COLOR_OPTIONS[0]);
  });

  it('trims the name tag and caps its length', () => {
    expect(normalizeCursorLabel('  Sam  ')).toBe('Sam');
    expect(normalizeCursorLabel('A very long collaborator name')).toHaveLength(18);
    expect(normalizeCursorLabel(42)).toBe('You');
  });
});

describe('cursor extents', () => {
  it('covers the hotspot for every drawn state', () => {
    for (const id of CURSOR_STYLE_IDS) {
      for (const state of CURSOR_PREVIEW_STATES) {
        const extent = getCursorStyleExtent(id, state, 'You');
        expect(extent.left, `${id}.${state}`).toBeLessThanOrEqual(0);
        expect(extent.top, `${id}.${state}`).toBeLessThanOrEqual(0);
        expect(extent.right, `${id}.${state}`).toBeGreaterThan(0);
        expect(extent.bottom, `${id}.${state}`).toBeGreaterThan(0);
      }
    }
  });

  it.each(['collaborator', 'rounded'] as const)('makes room for a longer %s name tag', (style) => {
    const short = getCursorStyleExtent(style, 'default', 'Al');
    const long = getCursorStyleExtent(style, 'default', 'Alexandra');
    expect(long.right).toBeGreaterThan(short.right);
    // Without a name there is no tag to make room for.
    expect(getCursorStyleExtent(style, 'default', '').right).toBeLessThan(short.right);
  });
});

describe('pointer angle', () => {
  it('aims the dart pointers along the macOS arrow, so tilting while moving looks right', () => {
    const mac = getPointerAxis('cursor01');
    // The macOS arrow leans about 23° left of straight up (its body points down-right ~66°).
    expect((mac * 180) / Math.PI).toBeCloseTo(66.6, 0);
    for (const style of ['wedge', 'collaborator', 'rounded'] as const) {
      expect(Math.abs(getPointerAxis(style) - mac), style).toBeLessThan((1 * Math.PI) / 180);
    }
  });
});
