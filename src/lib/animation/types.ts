/**
 * Named easing curves shown to users in plain words. Each takes an intensity
 * (0–1) so one curve covers "a little" to "a lot" without a curve editor.
 */
export type EasePreset =
  | 'smooth'
  | 'gentle'
  | 'snappy'
  | 'slowDown'
  | 'speedUp'
  | 'overshoot'
  | 'bounce'
  | 'elastic'
  | 'linear'
  | 'hold';

export type Easing =
  | { kind: 'preset'; name: EasePreset; intensity: number }
  | { kind: 'bezier'; x1: number; y1: number; x2: number; y2: number };
