import type { CursorClickSound } from '../../../store';

// Kept apart from audio.ts, which imports the recorded sounds: the main
// process loads saved projects through the store and must not pull those in.

export const CLICK_SOUND_OPTIONS: readonly CursorClickSound[] = [
  'none',
  'mouse',
  'mouse-2',
  'trackpad',
  'soft',
];

/** Sounds removed in favour of the current set, mapped to their closest replacement. */
const LEGACY_CLICK_SOUNDS: Record<string, CursorClickSound> = {
  'magic-mouse': 'trackpad',
  'mx-master': 'mouse',
  pop: 'soft',
  tick: 'soft',
};

export function normalizeCursorClickSound(value: unknown): CursorClickSound {
  if (typeof value !== 'string') {
    return 'none';
  }
  if ((CLICK_SOUND_OPTIONS as readonly string[]).includes(value)) {
    return value as CursorClickSound;
  }
  return LEGACY_CLICK_SOUNDS[value] ?? 'none';
}
