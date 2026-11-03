import type {
  CursorEvent,
  KeyCategory,
  KeyboardModifiers,
  RecordingResult,
} from '../../../types/index';
import type { MediaSegment } from '../../../types/timeline';
import type { MediaTrack } from '../../helpers/segments';
import { isMediaTrackEnabled, sortMediaSegments } from '../../helpers/segments';

export interface KeyEvent {
  t: number;
  type: 'keydown' | 'keyup';
  keyCategory: KeyCategory;
  modifiers: KeyboardModifiers;
  repeat: boolean;
  keyLabel?: string;
}

export interface TypingWindow {
  start: number;
  end: number;
  eventCount: number;
}

export interface KeyboardComboEvent {
  id: string;
  start: number;
  end: number;
  keys: string[];
  keyCategory: KeyCategory;
  modifierOnly: boolean;
  pulseTimes: number[];
}

export interface KeyboardData {
  keyEvents: KeyEvent[];
  typingWindows: TypingWindow[];
  comboEvents: KeyboardComboEvent[];
}

export interface KeyboardCaptionState {
  visible: boolean;
  keys: string[];
  opacity: number;
  scale: number;
  combo: KeyboardComboEvent | null;
}

export interface KeyboardComboOptions {
  minVisibleDuration?: number;
  releaseTail?: number;
  rapidReplacementGap?: number;
}

export interface KeyboardCaptionStateOptions {
  fadeIn?: number;
  fadeOut?: number;
  rapidReplacementGap?: number;
}

export const KEYBOARD_CAPTION_MIN_VISIBLE = 1.1;
export const KEYBOARD_CAPTION_RELEASE_TAIL = 0.55;
export const KEYBOARD_CAPTION_RAPID_REPLACEMENT_GAP = 0.9;
const KEYBOARD_CAPTION_FADE_IN = 0.18;
const KEYBOARD_CAPTION_FADE_OUT = 0.22;
const TYPING_WINDOW_GAP = 1.25;
const TYPING_WINDOW_END_PAD = 0.8;
const TYPING_WINDOW_MIN_EVENTS = 2;
const TYPING_WINDOW_MIN_DURATION = 0.4;

const MODIFIER_DISPLAY_ORDER: Array<keyof KeyboardModifiers> = ['meta', 'ctrl', 'alt', 'shift'];
const MODIFIER_LABELS: Record<keyof KeyboardModifiers, string> = {
  meta: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
};
const MODIFIER_KEY_LABELS = new Set([
  'Cmd',
  'Command',
  'Meta',
  '⌘',
  'Ctrl',
  'Control',
  '⌃',
  'Alt',
  'Option',
  '⌥',
  'Shift',
  '⇧',
]);
const NON_TEXT_CATEGORIES = new Set<KeyCategory>([
  'whitespace',
  'enter',
  'delete',
  'navigation',
  'system',
]);

// Screenforge internal shortcuts that must never appear in keyboard captions.
// Covers both Mac (⌘⌥) and Windows (⌃⌥) forms of CommandOrControl+Alt+[ / ].
// Use Set-based comparison so key press order doesn't matter.
const INTERNAL_COMBOS: ReadonlySet<string>[] = [
  new Set(['⌘', '⌥', '[']),
  new Set(['⌘', '⌥', ']']),
  new Set(['⌃', '⌥', '[']),
  new Set(['⌃', '⌥', ']']),
];

function isInternalCombo(keys: string[]): boolean {
  const keySet = new Set(keys);
  return INTERNAL_COMBOS.some(
    (combo) => combo.size === keySet.size && [...combo].every((k) => keySet.has(k)),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeKeyboardModifiers(
  modifiers?: Partial<KeyboardModifiers>,
): KeyboardModifiers {
  return {
    meta: modifiers?.meta === true,
    ctrl: modifiers?.ctrl === true,
    alt: modifiers?.alt === true,
    shift: modifiers?.shift === true,
  };
}

function hasAnyModifier(modifiers: KeyboardModifiers): boolean {
  return modifiers.meta || modifiers.ctrl || modifiers.alt || modifiers.shift;
}

function hasCommandModifier(modifiers: KeyboardModifiers): boolean {
  return modifiers.meta || modifiers.ctrl || modifiers.alt;
}

function modifierLabels(modifiers: KeyboardModifiers): string[] {
  return MODIFIER_DISPLAY_ORDER.flatMap((key) => (modifiers[key] ? [MODIFIER_LABELS[key]] : []));
}

function normalizeModifierLabel(label: string): string {
  switch (label) {
    case 'Cmd':
    case 'Command':
    case 'Meta':
      return '⌘';
    case 'Ctrl':
    case 'Control':
      return '⌃';
    case 'Alt':
    case 'Option':
      return '⌥';
    case 'Shift':
      return '⇧';
    default:
      return label;
  }
}

function normalizeKeyLabel(label: string): string {
  switch (label) {
    case 'Tab':
      return '⇥';
    case 'Return':
    case 'Enter':
      return '↵';
    case 'Escape':
    case 'Esc':
      return '⎋';
    case 'Space':
    case ' ':
      return '⎵';
    case 'Backspace':
      return '⌫';
    case 'Delete':
      return '⌦';
    case 'ArrowUp':
    case 'Up':
      return '↑';
    case 'ArrowDown':
    case 'Down':
      return '↓';
    case 'ArrowLeft':
    case 'Left':
      return '←';
    case 'ArrowRight':
    case 'Right':
      return '→';
    case 'PageUp':
      return '⇞';
    case 'PageDown':
      return '⇟';
    case 'Home':
      return '↖';
    case 'End':
      return '↘';
    case 'CapsLock':
      return '⇪';
    default:
      return label;
  }
}

function mergeKeyLabels(...groups: string[][]): string[] {
  const seen = new Set<string>();
  return groups.flatMap((group) =>
    group.flatMap((label) => {
      const normalized = normalizeModifierLabel(label);
      if (seen.has(normalized)) {
        return [];
      }
      seen.add(normalized);
      return [normalized];
    }),
  );
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function comboIncludesModifierKeys(comboKeys: string[], modifierKeys: string[]): boolean {
  return modifierKeys.length > 0 && modifierKeys.every((key) => comboKeys.includes(key));
}

function getEventModifierLabels(event: KeyEvent): string[] {
  const labels = modifierLabels(event.modifiers);
  const label = event.keyLabel?.trim();
  if (event.keyCategory === 'modifier' && label) {
    labels.push(label);
  }
  return mergeKeyLabels(labels);
}

function buildComboKeys(
  event: KeyEvent,
  activeModifierLabels: string[] = [],
): { keys: string[]; modifierOnly: boolean } | null {
  const label = event.keyLabel?.trim();
  const modifiers = mergeKeyLabels(activeModifierLabels, modifierLabels(event.modifiers));

  if (event.keyCategory === 'modifier') {
    const keys = modifiers.length > 0 ? modifiers : label ? [normalizeModifierLabel(label)] : [];
    if (keys.every((k) => k === '⇧')) {
      return null;
    }
    return keys.length > 0 ? { keys, modifierOnly: true } : null;
  }

  if (!label) {
    return null;
  }

  const isShortcut = event.keyCategory === 'shortcut';
  const isModifiedNonText =
    hasAnyModifier(event.modifiers) && NON_TEXT_CATEGORIES.has(event.keyCategory);
  const isModifiedCharacter =
    hasCommandModifier(event.modifiers) && event.keyCategory === 'character';
  if (!isShortcut && !isModifiedNonText && !isModifiedCharacter) {
    return null;
  }

  const keys = [...modifiers];
  if (!MODIFIER_KEY_LABELS.has(label) && !keys.includes(label)) {
    keys.push(normalizeKeyLabel(label));
  }

  return keys.length > 0 ? { keys, modifierOnly: false } : null;
}

function findReleaseTime(events: KeyEvent[], startIndex: number, event: KeyEvent): number | null {
  const label = event.keyLabel;
  for (let index = startIndex + 1; index < events.length; index += 1) {
    const candidate = events[index];
    if (candidate.type !== 'keyup') {
      continue;
    }
    if (label && candidate.keyLabel === label) {
      return candidate.t;
    }
    if (!label && candidate.keyCategory === event.keyCategory) {
      return candidate.t;
    }
  }
  return null;
}

export const getKeyEvents = (events: CursorEvent[], startTime: number): KeyEvent[] =>
  events
    .filter((e) => e.type === 'keydown' || e.type === 'keyup')
    .map((e) => ({
      t: (e.timestamp - startTime) / 1000,
      type: e.type as 'keydown' | 'keyup',
      keyCategory: e.keyCategory ?? 'unknown',
      modifiers: normalizeKeyboardModifiers(e.modifiers),
      repeat: e.repeat === true,
      keyLabel: typeof e.keyLabel === 'string' && e.keyLabel.length > 0 ? e.keyLabel : undefined,
    }))
    .filter((e) => e.t >= 0)
    .sort((a, b) => a.t - b.t);

function isTypingKey(event: KeyEvent): boolean {
  return (
    event.type === 'keydown' &&
    (event.keyCategory === 'character' ||
      event.keyCategory === 'whitespace' ||
      event.keyCategory === 'enter' ||
      event.keyCategory === 'delete')
  );
}

function commitTypingWindow(events: KeyEvent[], windows: TypingWindow[]): void {
  if (events.length === 0) {
    return;
  }

  const start = events[0].t;
  const last = events[events.length - 1].t;
  if (events.length < TYPING_WINDOW_MIN_EVENTS && last - start < TYPING_WINDOW_MIN_DURATION) {
    return;
  }

  windows.push({
    start,
    end: last + TYPING_WINDOW_END_PAD,
    eventCount: events.length,
  });
}

export function getTypingWindows(keyEvents: KeyEvent[]): TypingWindow[] {
  const typingEvents = keyEvents.filter(isTypingKey);
  const windows: TypingWindow[] = [];
  let current: KeyEvent[] = [];

  for (const event of typingEvents) {
    const previous = current[current.length - 1];
    if (!previous || event.t - previous.t <= TYPING_WINDOW_GAP) {
      current.push(event);
      continue;
    }

    commitTypingWindow(current, windows);
    current = [event];
  }

  commitTypingWindow(current, windows);
  return windows;
}

export function getKeyboardCombos(
  keyEvents: KeyEvent[],
  options: KeyboardComboOptions = {},
): KeyboardComboEvent[] {
  const minVisibleDuration = options.minVisibleDuration ?? KEYBOARD_CAPTION_MIN_VISIBLE;
  const releaseTail = options.releaseTail ?? KEYBOARD_CAPTION_RELEASE_TAIL;
  const rapidReplacementGap = options.rapidReplacementGap ?? KEYBOARD_CAPTION_RAPID_REPLACEMENT_GAP;
  const combos: KeyboardComboEvent[] = [];
  const activeModifierLabels = new Set<string>();

  keyEvents.forEach((event, index) => {
    if (event.type === 'keyup') {
      if (event.keyCategory === 'modifier') {
        for (const label of getEventModifierLabels(event)) {
          activeModifierLabels.delete(label);
        }
      }
      return;
    }

    if (event.keyCategory === 'modifier') {
      for (const label of getEventModifierLabels(event)) {
        activeModifierLabels.add(label);
      }
    }

    if (event.repeat) {
      return;
    }

    const combo = buildComboKeys(event, [...activeModifierLabels]);
    if (!combo) {
      return;
    }
    if (isInternalCombo(combo.keys)) {
      // Also remove the preceding modifier-only entry so ⌘⌥ alone doesn't linger
      const preceding = combos[combos.length - 1];
      if (preceding?.modifierOnly && comboIncludesModifierKeys(combo.keys, preceding.keys)) {
        combos.pop();
      }
      return;
    }

    const releaseTime = findReleaseTime(keyEvents, index, event);
    const end = Math.max(event.t + minVisibleDuration, (releaseTime ?? event.t) + releaseTail);
    let previous = combos[combos.length - 1];

    if (
      previous &&
      previous.modifierOnly &&
      !combo.modifierOnly &&
      event.t - previous.start <= rapidReplacementGap &&
      comboIncludesModifierKeys(combo.keys, previous.keys)
    ) {
      combos.pop();
      previous = combos[combos.length - 1];
    }

    if (
      previous &&
      sameKeys(previous.keys, combo.keys) &&
      event.t <= previous.end + rapidReplacementGap
    ) {
      previous.end = Math.max(previous.end, end);
      previous.pulseTimes.push(event.t);
      return;
    }

    combos.push({
      id: `keyboard-combo-${combos.length + 1}`,
      start: event.t,
      end,
      keys: combo.keys,
      keyCategory: event.keyCategory,
      modifierOnly: combo.modifierOnly,
      pulseTimes: [],
    });
  });

  return combos;
}

export function resolveKeyboardCaptionState(
  comboEvents: KeyboardComboEvent[],
  time: number,
  options: KeyboardCaptionStateOptions = {},
): KeyboardCaptionState {
  const fadeIn = options.fadeIn ?? KEYBOARD_CAPTION_FADE_IN;
  const fadeOut = options.fadeOut ?? KEYBOARD_CAPTION_FADE_OUT;
  const rapidReplacementGap = options.rapidReplacementGap ?? KEYBOARD_CAPTION_RAPID_REPLACEMENT_GAP;

  let activeIndex = -1;
  for (let index = 0; index < comboEvents.length; index += 1) {
    if (comboEvents[index].start <= time) {
      activeIndex = index;
      continue;
    }
    break;
  }

  if (activeIndex < 0) {
    return { visible: false, keys: [], opacity: 0, scale: 0.96, combo: null };
  }

  const combo = comboEvents[activeIndex];
  const nextCombo = comboEvents[activeIndex + 1];
  const bridgeToNext =
    nextCombo && nextCombo.start > combo.end && nextCombo.start - combo.end <= rapidReplacementGap;
  const holdEnd = bridgeToNext ? nextCombo.start : combo.end;
  const finalEnd = holdEnd + (bridgeToNext ? 0 : fadeOut);

  if (time > finalEnd) {
    return { visible: false, keys: [], opacity: 0, scale: 0.96, combo: null };
  }

  const inProgress = fadeIn <= 0 ? 1 : clamp((time - combo.start) / fadeIn, 0, 1);
  const outProgress =
    bridgeToNext || time <= holdEnd || fadeOut <= 0
      ? 1
      : clamp(1 - (time - holdEnd) / fadeOut, 0, 1);
  const opacity = clamp(Math.min(inProgress, outProgress), 0, 1);

  const easedIn = inProgress * (2 - inProgress);
  const PULSE_DURATION = 0.2;
  let pulseBoost = 0;
  for (const pulseT of combo.pulseTimes) {
    const p = (time - pulseT) / PULSE_DURATION;
    if (p > 0 && p < 1) {
      pulseBoost = Math.max(pulseBoost, Math.sin(p * Math.PI) * 0.05);
    }
  }
  return {
    visible: opacity > 0.001,
    keys: combo.keys,
    opacity,
    scale: 0.88 + 0.12 * easedIn + pulseBoost,
    combo,
  };
}

export function analyzeKeyboardData(recording: RecordingResult): KeyboardData {
  if (typeof recording.startTime !== 'number') {
    return {
      keyEvents: [],
      typingWindows: [],
      comboEvents: [],
    };
  }

  const keyEvents = getKeyEvents(recording.mouseData, recording.startTime);
  return {
    keyEvents,
    typingWindows: getTypingWindows(keyEvents),
    comboEvents: getKeyboardCombos(keyEvents),
  };
}

type TimedEvent = {
  t: number;
};

function mapSourceTimeToTimelineTime(
  segments: MediaSegment[],
  sourceTime: number,
  track: MediaTrack,
): number | null {
  for (const segment of segments) {
    if (!isMediaTrackEnabled(segment, track)) {
      continue;
    }

    const startsBeforeEnd = sourceTime < segment.sourceEnd;
    const matchesTrailingEdge = Math.abs(sourceTime - segment.sourceEnd) <= 0.0001;
    if (sourceTime < segment.sourceStart || (!startsBeforeEnd && !matchesTrailingEdge)) {
      continue;
    }

    return segment.timelineStart + (sourceTime - segment.sourceStart) / (segment.speed ?? 1);
  }

  return null;
}

function mapTimedEventsToTimeline<T extends TimedEvent>(
  events: T[],
  segments: MediaSegment[],
  track: MediaTrack,
): T[] {
  return events
    .flatMap((event) => {
      const mappedTime = mapSourceTimeToTimelineTime(segments, event.t, track);
      return mappedTime === null ? [] : [{ ...event, t: mappedTime }];
    })
    .sort((a, b) => a.t - b.t);
}

function mapTypingWindowsToTimeline(
  windows: TypingWindow[],
  segments: MediaSegment[],
  track: MediaTrack,
): TypingWindow[] {
  return windows
    .flatMap((window) => {
      const start = mapSourceTimeToTimelineTime(segments, window.start, track);
      const end = mapSourceTimeToTimelineTime(segments, window.end, track);
      return start === null || end === null || end <= start ? [] : [{ ...window, start, end }];
    })
    .sort((a, b) => a.start - b.start);
}

function mapKeyboardCombosToTimeline(
  combos: KeyboardComboEvent[],
  segments: MediaSegment[],
  track: MediaTrack,
): KeyboardComboEvent[] {
  return combos
    .flatMap((combo) => {
      const start = mapSourceTimeToTimelineTime(segments, combo.start, track);
      const end = mapSourceTimeToTimelineTime(segments, combo.end, track);
      if (start === null || end === null || end <= start) {
        return [];
      }
      const pulseTimes = combo.pulseTimes
        .map((pt) => mapSourceTimeToTimelineTime(segments, pt, track))
        .filter((pt): pt is number => pt !== null);
      return [{ ...combo, start, end, pulseTimes }];
    })
    .sort((a, b) => a.start - b.start);
}

export function mapKeyboardDataToTimeline(
  data: KeyboardData,
  segments: MediaSegment[],
  track: MediaTrack = 'video',
): KeyboardData {
  const orderedSegments = sortMediaSegments(segments);
  if (orderedSegments.length === 0) {
    return {
      keyEvents: [],
      typingWindows: [],
      comboEvents: [],
    };
  }

  return {
    keyEvents: mapTimedEventsToTimeline(data.keyEvents, orderedSegments, track),
    typingWindows: mapTypingWindowsToTimeline(data.typingWindows, orderedSegments, track),
    comboEvents: mapKeyboardCombosToTimeline(data.comboEvents, orderedSegments, track),
  };
}
