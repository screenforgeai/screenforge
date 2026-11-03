import type { CursorEvent, KeyCategory, KeyboardModifiers } from '../../../src/types/index';

const UIOHOOK_KEYS = {
  Backspace: 14,
  Tab: 15,
  Enter: 28,
  CapsLock: 58,
  Escape: 1,
  Space: 57,
  PageUp: 3657,
  PageDown: 3665,
  End: 3663,
  Home: 3655,
  ArrowLeft: 57419,
  ArrowUp: 57416,
  ArrowRight: 57421,
  ArrowDown: 57424,
  Insert: 3666,
  Delete: 3667,
  NumpadEnter: 3612,
  NumpadEnd: 0xee00 | 0x004f,
  NumpadArrowDown: 0xee00 | 0x0050,
  NumpadPageDown: 0xee00 | 0x0051,
  NumpadArrowLeft: 0xee00 | 0x004b,
  NumpadArrowRight: 0xee00 | 0x004d,
  NumpadHome: 0xee00 | 0x0047,
  NumpadArrowUp: 0xee00 | 0x0048,
  NumpadPageUp: 0xee00 | 0x0049,
  NumpadInsert: 0xee00 | 0x0052,
  NumpadDelete: 0xee00 | 0x0053,
  Ctrl: 29,
  CtrlRight: 3613,
  Alt: 56,
  AltRight: 3640,
  Shift: 42,
  ShiftRight: 54,
  Meta: 3675,
  MetaRight: 3676,
  NumLock: 69,
  ScrollLock: 70,
  PrintScreen: 3639,
} as const;

const UIOHOOK_CHARACTER_KEYCODES = new Set<number>([
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 30, 31,
  32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 55, 71, 72,
  73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 3637,
]);

const UIOHOOK_FUNCTION_KEYCODES = new Set<number>([
  59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 87, 88, 91, 92, 93, 99, 100, 101, 102, 103, 104, 105, 106,
  107,
]);

const UIOHOOK_KEY_LABELS = new Map<number, string>([
  [UIOHOOK_KEYS.Backspace, 'Backspace'],
  [UIOHOOK_KEYS.Tab, 'Tab'],
  [UIOHOOK_KEYS.Enter, 'Enter'],
  [UIOHOOK_KEYS.NumpadEnter, 'Enter'],
  [UIOHOOK_KEYS.CapsLock, 'Caps Lock'],
  [UIOHOOK_KEYS.Escape, 'Esc'],
  [UIOHOOK_KEYS.Space, 'Space'],
  [UIOHOOK_KEYS.PageUp, 'Page Up'],
  [UIOHOOK_KEYS.PageDown, 'Page Down'],
  [UIOHOOK_KEYS.End, 'End'],
  [UIOHOOK_KEYS.Home, 'Home'],
  [UIOHOOK_KEYS.ArrowLeft, 'Left'],
  [UIOHOOK_KEYS.ArrowUp, 'Up'],
  [UIOHOOK_KEYS.ArrowRight, 'Right'],
  [UIOHOOK_KEYS.ArrowDown, 'Down'],
  [UIOHOOK_KEYS.Insert, 'Insert'],
  [UIOHOOK_KEYS.Delete, 'Delete'],
  [UIOHOOK_KEYS.Ctrl, 'Ctrl'],
  [UIOHOOK_KEYS.CtrlRight, 'Ctrl'],
  [UIOHOOK_KEYS.Alt, 'Option'],
  [UIOHOOK_KEYS.AltRight, 'Option'],
  [UIOHOOK_KEYS.Shift, 'Shift'],
  [UIOHOOK_KEYS.ShiftRight, 'Shift'],
  [UIOHOOK_KEYS.Meta, 'Cmd'],
  [UIOHOOK_KEYS.MetaRight, 'Cmd'],
  [UIOHOOK_KEYS.NumLock, 'Num Lock'],
  [UIOHOOK_KEYS.ScrollLock, 'Scroll Lock'],
  [UIOHOOK_KEYS.PrintScreen, 'Print Screen'],
  [2, '1'],
  [3, '2'],
  [4, '3'],
  [5, '4'],
  [6, '5'],
  [7, '6'],
  [8, '7'],
  [9, '8'],
  [10, '9'],
  [11, '0'],
  [12, '-'],
  [13, '='],
  [16, 'Q'],
  [17, 'W'],
  [18, 'E'],
  [19, 'R'],
  [20, 'T'],
  [21, 'Y'],
  [22, 'U'],
  [23, 'I'],
  [24, 'O'],
  [25, 'P'],
  [26, '['],
  [27, ']'],
  [30, 'A'],
  [31, 'S'],
  [32, 'D'],
  [33, 'F'],
  [34, 'G'],
  [35, 'H'],
  [36, 'J'],
  [37, 'K'],
  [38, 'L'],
  [39, ';'],
  [40, "'"],
  [41, '`'],
  [43, '\\'],
  [44, 'Z'],
  [45, 'X'],
  [46, 'C'],
  [47, 'V'],
  [48, 'B'],
  [49, 'N'],
  [50, 'M'],
  [51, ','],
  [52, '.'],
  [53, '/'],
  [55, '*'],
  [59, 'F1'],
  [60, 'F2'],
  [61, 'F3'],
  [62, 'F4'],
  [63, 'F5'],
  [64, 'F6'],
  [65, 'F7'],
  [66, 'F8'],
  [67, 'F9'],
  [68, 'F10'],
  [87, 'F11'],
  [88, 'F12'],
  [91, 'F13'],
  [92, 'F14'],
  [93, 'F15'],
  [99, 'F16'],
  [100, 'F17'],
  [101, 'F18'],
  [102, 'F19'],
  [103, 'F20'],
  [104, 'F21'],
  [105, 'F22'],
  [106, 'F23'],
  [107, 'F24'],
]);

export interface UiohookKeyboardEventLike {
  keycode: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export const KEY_CATEGORIES: readonly KeyCategory[] = [
  'character',
  'whitespace',
  'enter',
  'delete',
  'navigation',
  'modifier',
  'shortcut',
  'system',
  'unknown',
];

export function normalizeKeyCategory(value: unknown): KeyCategory {
  return typeof value === 'string' && KEY_CATEGORIES.includes(value as KeyCategory)
    ? (value as KeyCategory)
    : 'unknown';
}

export function normalizeKeyLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 16 ? trimmed : undefined;
}

export function normalizeKeyboardModifiers(value?: Partial<KeyboardModifiers>): KeyboardModifiers {
  return {
    meta: value?.meta === true,
    ctrl: value?.ctrl === true,
    alt: value?.alt === true,
    shift: value?.shift === true,
  };
}

export function getUiohookKeyboardModifiers(event: UiohookKeyboardEventLike): KeyboardModifiers {
  return {
    meta: event.metaKey === true,
    ctrl: event.ctrlKey === true,
    alt: event.altKey === true,
    shift: event.shiftKey === true,
  };
}

function hasCommandModifier(modifiers: KeyboardModifiers): boolean {
  return modifiers.meta || modifiers.ctrl || modifiers.alt;
}

function hasAnyModifier(modifiers: KeyboardModifiers): boolean {
  return modifiers.meta || modifiers.ctrl || modifiers.alt || modifiers.shift;
}

export function shouldPersistKeyLabel(
  category: KeyCategory,
  modifiers: KeyboardModifiers = normalizeKeyboardModifiers(),
): boolean {
  return (
    category === 'modifier' ||
    category === 'shortcut' ||
    category === 'navigation' ||
    category === 'system' ||
    ((category === 'whitespace' || category === 'enter' || category === 'delete') &&
      hasAnyModifier(modifiers)) ||
    (category === 'character' && hasCommandModifier(modifiers))
  );
}

export function categorizeUiohookKey(
  keycode: number,
  modifiers: KeyboardModifiers = normalizeKeyboardModifiers(),
): KeyCategory {
  if (
    keycode === UIOHOOK_KEYS.Ctrl ||
    keycode === UIOHOOK_KEYS.CtrlRight ||
    keycode === UIOHOOK_KEYS.Alt ||
    keycode === UIOHOOK_KEYS.AltRight ||
    keycode === UIOHOOK_KEYS.Shift ||
    keycode === UIOHOOK_KEYS.ShiftRight ||
    keycode === UIOHOOK_KEYS.Meta ||
    keycode === UIOHOOK_KEYS.MetaRight ||
    keycode === UIOHOOK_KEYS.CapsLock
  ) {
    return 'modifier';
  }

  if (keycode === UIOHOOK_KEYS.Space || keycode === UIOHOOK_KEYS.Tab) {
    return hasCommandModifier(modifiers) ? 'shortcut' : 'whitespace';
  }

  if (keycode === UIOHOOK_KEYS.Enter || keycode === UIOHOOK_KEYS.NumpadEnter) {
    return hasCommandModifier(modifiers) ? 'shortcut' : 'enter';
  }

  if (
    keycode === UIOHOOK_KEYS.Backspace ||
    keycode === UIOHOOK_KEYS.Delete ||
    keycode === UIOHOOK_KEYS.NumpadDelete
  ) {
    return hasCommandModifier(modifiers) ? 'shortcut' : 'delete';
  }

  if (
    keycode === UIOHOOK_KEYS.ArrowLeft ||
    keycode === UIOHOOK_KEYS.ArrowUp ||
    keycode === UIOHOOK_KEYS.ArrowRight ||
    keycode === UIOHOOK_KEYS.ArrowDown ||
    keycode === UIOHOOK_KEYS.PageUp ||
    keycode === UIOHOOK_KEYS.PageDown ||
    keycode === UIOHOOK_KEYS.Home ||
    keycode === UIOHOOK_KEYS.End ||
    keycode === UIOHOOK_KEYS.Insert ||
    keycode === UIOHOOK_KEYS.NumpadArrowLeft ||
    keycode === UIOHOOK_KEYS.NumpadArrowUp ||
    keycode === UIOHOOK_KEYS.NumpadArrowRight ||
    keycode === UIOHOOK_KEYS.NumpadArrowDown ||
    keycode === UIOHOOK_KEYS.NumpadPageUp ||
    keycode === UIOHOOK_KEYS.NumpadPageDown ||
    keycode === UIOHOOK_KEYS.NumpadHome ||
    keycode === UIOHOOK_KEYS.NumpadEnd ||
    keycode === UIOHOOK_KEYS.NumpadInsert
  ) {
    return hasCommandModifier(modifiers) ? 'shortcut' : 'navigation';
  }

  if (
    keycode === UIOHOOK_KEYS.Escape ||
    keycode === UIOHOOK_KEYS.NumLock ||
    keycode === UIOHOOK_KEYS.ScrollLock ||
    keycode === UIOHOOK_KEYS.PrintScreen ||
    UIOHOOK_FUNCTION_KEYCODES.has(keycode)
  ) {
    return 'system';
  }

  if (UIOHOOK_CHARACTER_KEYCODES.has(keycode)) {
    return hasCommandModifier(modifiers) ? 'shortcut' : 'character';
  }

  return 'unknown';
}

export function toCategorizedKeyboardEvent(
  type: 'keydown' | 'keyup',
  event: UiohookKeyboardEventLike,
  timestamp: number = Date.now(),
): CursorEvent {
  const modifiers = getUiohookKeyboardModifiers(event);
  const keyCategory = categorizeUiohookKey(event.keycode, modifiers);
  const keyLabel = shouldPersistKeyLabel(keyCategory, modifiers)
    ? UIOHOOK_KEY_LABELS.get(event.keycode)
    : undefined;
  return {
    type,
    timestamp,
    keyCategory,
    ...(keyLabel ? { keyLabel } : {}),
    modifiers,
  };
}
