import { describe, expect, it } from 'vitest';
import {
  categorizeUiohookKey,
  normalizeKeyLabel,
  normalizeKeyCategory,
  toCategorizedKeyboardEvent,
} from './input-events';

describe('keyboard input event categorization', () => {
  it('stores key categories and modifier state without storing actual key values', () => {
    const event = toCategorizedKeyboardEvent(
      'keydown',
      { keycode: 30, metaKey: true, ctrlKey: false, altKey: false, shiftKey: false },
      1_234,
    );

    expect(event).toEqual({
      type: 'keydown',
      timestamp: 1_234,
      keyCategory: 'shortcut',
      keyLabel: 'A',
      modifiers: { meta: true, ctrl: false, alt: false, shift: false },
    });
    expect('keycode' in event).toBe(false);
    expect('key' in event).toBe(false);
  });

  it('classifies text-editing keys separately from shortcuts and system keys', () => {
    expect(categorizeUiohookKey(30, { meta: false, ctrl: false, alt: false, shift: false })).toBe(
      'character',
    );
    expect(categorizeUiohookKey(57, { meta: false, ctrl: false, alt: false, shift: false })).toBe(
      'whitespace',
    );
    expect(categorizeUiohookKey(14, { meta: false, ctrl: false, alt: false, shift: false })).toBe(
      'delete',
    );
    expect(categorizeUiohookKey(30, { meta: false, ctrl: true, alt: false, shift: false })).toBe(
      'shortcut',
    );
    expect(categorizeUiohookKey(1, { meta: false, ctrl: false, alt: false, shift: false })).toBe(
      'system',
    );
  });

  it('normalizes unknown native categories without leaking raw data', () => {
    expect(normalizeKeyCategory('character')).toBe('character');
    expect(normalizeKeyCategory('raw-a-key')).toBe('unknown');
    expect(normalizeKeyCategory(30)).toBe('unknown');
  });

  it('does not store labels for plain typed characters or shift-only characters', () => {
    const plain = toCategorizedKeyboardEvent('keydown', { keycode: 30 }, 100);
    const shifted = toCategorizedKeyboardEvent('keydown', { keycode: 30, shiftKey: true }, 200);

    expect(plain.keyCategory).toBe('character');
    expect(plain.keyLabel).toBeUndefined();
    expect(shifted.keyCategory).toBe('character');
    expect(shifted.keyLabel).toBeUndefined();
    expect(toCategorizedKeyboardEvent('keydown', { keycode: 57 }, 300).keyLabel).toBeUndefined();
    expect(toCategorizedKeyboardEvent('keydown', { keycode: 28 }, 400).keyLabel).toBeUndefined();
  });

  it('keeps safe labels for modifier and non-text keys', () => {
    expect(toCategorizedKeyboardEvent('keydown', { keycode: 3675, metaKey: true }).keyLabel).toBe(
      'Cmd',
    );
    expect(toCategorizedKeyboardEvent('keydown', { keycode: 15, shiftKey: true }).keyLabel).toBe(
      'Tab',
    );
    expect(toCategorizedKeyboardEvent('keydown', { keycode: 57419 }).keyLabel).toBe('Left');
  });

  it('normalizes native labels conservatively', () => {
    expect(normalizeKeyLabel(' Cmd ')).toBe('Cmd');
    expect(normalizeKeyLabel('')).toBeUndefined();
    expect(normalizeKeyLabel('a'.repeat(40))).toBeUndefined();
    expect(normalizeKeyLabel(30)).toBeUndefined();
  });
});
