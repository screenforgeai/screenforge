import { describe, expect, it } from 'vitest';
import type { DesktopSource } from '../../types/index';
import { formatScreenSize, listChoosableScreens, resolveChosenScreen } from './displayChoice';

const screenSource = (id: string, extra: Partial<DesktopSource> = {}): DesktopSource => ({
  id,
  name: id,
  thumbnail: null,
  appIcon: null,
  ...extra,
});

const laptop = screenSource('screen:0:0', {
  isPrimary: true,
  displaySize: { width: 1440, height: 900 },
});
const external = screenSource('screen:1:0', { displaySize: { width: 2560, height: 1440 } });
const window = screenSource('window:42:0');

describe('displayChoice', () => {
  it('lists only real screens', () => {
    expect(
      listChoosableScreens([laptop, window, external, screenSource('screen:wayland')]),
    ).toEqual([laptop, external]);
  });

  it('records the chosen screen', () => {
    expect(resolveChosenScreen([laptop, external], external.id)).toBe(external);
  });

  it('records the main display until a screen is chosen', () => {
    expect(resolveChosenScreen([external, laptop], null)).toBe(laptop);
  });

  it('falls back to the main display when the chosen screen was unplugged', () => {
    expect(resolveChosenScreen([external, laptop], 'screen:2:0')).toBe(laptop);
  });

  it('falls back to the first screen when none is known to be the main one', () => {
    const a = screenSource('screen:5');
    const b = screenSource('screen:6');
    expect(resolveChosenScreen([a, b], null)).toBe(a);
  });

  it('has nothing to record when no screen is listed', () => {
    expect(resolveChosenScreen([window], null)).toBeNull();
  });

  it('formats the screen size', () => {
    expect(formatScreenSize(external)).toBe('2560 × 1440');
    expect(formatScreenSize(window)).toBeNull();
  });
});
