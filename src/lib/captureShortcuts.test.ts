import { describe, expect, it } from 'vitest';
import { CAPTURE_SHORTCUTS, formatShortcut, shortcutKeys } from './captureShortcuts';

describe('capture shortcuts', () => {
  it('writes macOS shortcuts with modifier symbols', () => {
    expect(formatShortcut(CAPTURE_SHORTCUTS.screenshot, true)).toBe('⌥⇧S');
    expect(formatShortcut('CommandOrControl+Control+R', true)).toBe('⌘⌃R');
  });

  it('writes Windows and Linux shortcuts with key names', () => {
    expect(formatShortcut(CAPTURE_SHORTCUTS.record, false)).toBe('Alt+Shift+R');
    expect(formatShortcut('CommandOrControl+Shift+S', false)).toBe('Ctrl+Shift+S');
  });

  it('splits a shortcut into the keys to press', () => {
    expect(shortcutKeys(CAPTURE_SHORTCUTS.screenshot, true)).toEqual(['⌥', '⇧', 'S']);
    expect(shortcutKeys(CAPTURE_SHORTCUTS.screenshot, false)).toEqual(['Alt', 'Shift', 'S']);
  });
});
