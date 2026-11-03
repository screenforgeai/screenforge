import { describe, expect, it } from 'vitest';
import type { CursorEvent, KeyCategory, KeyboardModifiers, RecordingResult } from '../../../types';
import {
  analyzeKeyboardData,
  getKeyboardCombos,
  resolveKeyboardCaptionState,
  type KeyEvent,
} from './analyze';

const START_TIME = 1_000;
const NO_MODIFIERS: KeyboardModifiers = { meta: false, ctrl: false, alt: false, shift: false };

function key(
  t: number,
  type: 'keydown' | 'keyup',
  keyCategory: KeyCategory,
  options: {
    keyLabel?: string;
    modifiers?: Partial<KeyboardModifiers>;
    repeat?: boolean;
  } = {},
): CursorEvent {
  return {
    type,
    keyCategory,
    keyLabel: options.keyLabel,
    modifiers: { ...NO_MODIFIERS, ...options.modifiers },
    repeat: options.repeat,
    timestamp: START_TIME + t * 1000,
  };
}

function makeRecording(events: CursorEvent[]): RecordingResult {
  return {
    filePath: 'fixture.mp4',
    mouseData: [...events].sort((a, b) => a.timestamp - b.timestamp),
    duration: 5,
    startTime: START_TIME,
    recordingArea: { x: 0, y: 0, width: 1000, height: 1000 },
  };
}

describe('keyboard analyzer', () => {
  it('suppresses plain typing captions while keeping typing windows', () => {
    const data = analyzeKeyboardData(
      makeRecording([
        key(0.1, 'keydown', 'character'),
        key(0.35, 'keydown', 'character'),
        key(0.7, 'keydown', 'whitespace', { keyLabel: 'Space' }),
      ]),
    );

    expect(data.comboEvents).toHaveLength(0);
    expect(data.typingWindows).toHaveLength(1);
  });

  it('creates modifier-only captions', () => {
    const data = analyzeKeyboardData(
      makeRecording([
        key(0.1, 'keydown', 'modifier', { keyLabel: 'Cmd', modifiers: { meta: true } }),
        key(0.4, 'keyup', 'modifier', { keyLabel: 'Cmd' }),
      ]),
    );

    expect(data.comboEvents).toHaveLength(1);
    expect(data.comboEvents[0].keys).toEqual(['⌘']);
    expect(data.comboEvents[0].modifierOnly).toBe(true);
    expect(data.comboEvents[0].end - data.comboEvents[0].start).toBeGreaterThanOrEqual(1.1);
  });

  it('creates clean shortcut combinations from safe labels', () => {
    const data = analyzeKeyboardData(
      makeRecording([
        key(0.1, 'keydown', 'shortcut', { keyLabel: 'K', modifiers: { meta: true } }),
        key(0.25, 'keyup', 'shortcut', { keyLabel: 'K', modifiers: { meta: true } }),
      ]),
    );

    expect(data.comboEvents).toHaveLength(1);
    expect(data.comboEvents[0].keys).toEqual(['⌘', 'K']);
  });

  it('combines held modifiers with following shortcut labels when the shortcut event misses flags', () => {
    const data = analyzeKeyboardData(
      makeRecording([
        key(0.1, 'keydown', 'modifier', { keyLabel: 'Cmd', modifiers: { meta: true } }),
        key(0.18, 'keydown', 'shortcut', { keyLabel: 'B' }),
        key(0.3, 'keyup', 'shortcut', { keyLabel: 'B' }),
        key(0.34, 'keyup', 'modifier', { keyLabel: 'Cmd' }),
      ]),
    );

    expect(data.comboEvents).toHaveLength(1);
    expect(data.comboEvents[0].keys).toEqual(['⌘', 'B']);
  });

  it('supports shift combinations for non-text keys without storing typed text', () => {
    const data = analyzeKeyboardData(
      makeRecording([
        key(0.1, 'keydown', 'whitespace', { keyLabel: 'Tab', modifiers: { shift: true } }),
        key(0.2, 'keydown', 'character', { modifiers: { shift: true } }),
      ]),
    );

    expect(data.comboEvents).toHaveLength(1);
    expect(data.comboEvents[0].keys).toEqual(['⇧', '⇥']);
  });

  it('suppresses repeated keydown duplicates and extends the current caption', () => {
    const combos = getKeyboardCombos([
      {
        t: 0.1,
        type: 'keydown',
        keyCategory: 'shortcut',
        keyLabel: 'K',
        modifiers: { meta: true, ctrl: false, alt: false, shift: false },
        repeat: false,
      },
      {
        t: 0.25,
        type: 'keydown',
        keyCategory: 'shortcut',
        keyLabel: 'K',
        modifiers: { meta: true, ctrl: false, alt: false, shift: false },
        repeat: true,
      },
      {
        t: 0.8,
        type: 'keydown',
        keyCategory: 'shortcut',
        keyLabel: 'K',
        modifiers: { meta: true, ctrl: false, alt: false, shift: false },
        repeat: false,
      },
    ] as KeyEvent[]);

    expect(combos).toHaveLength(1);
    expect(combos[0].end).toBeGreaterThan(1.8);
  });

  it('keeps the popup alive and swaps content for rapid successive shortcuts', () => {
    const data = analyzeKeyboardData(
      makeRecording([
        key(0.1, 'keydown', 'shortcut', { keyLabel: 'K', modifiers: { meta: true } }),
        key(0.2, 'keyup', 'shortcut', { keyLabel: 'K', modifiers: { meta: true } }),
        key(1.45, 'keydown', 'shortcut', { keyLabel: 'P', modifiers: { meta: true, shift: true } }),
      ]),
    );

    expect(data.comboEvents).toHaveLength(2);
    expect(resolveKeyboardCaptionState(data.comboEvents, 1.3).visible).toBe(true);
    expect(resolveKeyboardCaptionState(data.comboEvents, 1.3).keys).toEqual(['⌘', 'K']);
    expect(resolveKeyboardCaptionState(data.comboEvents, 1.5).keys).toEqual(['⌘', '⇧', 'P']);
  });
});
