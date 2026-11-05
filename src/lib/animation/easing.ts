import type { EasePreset, Easing } from './types';

export const EASE_PRESETS: readonly EasePreset[] = [
  'smooth',
  'gentle',
  'snappy',
  'slowDown',
  'speedUp',
  'overshoot',
  'bounce',
  'elastic',
  'linear',
  'hold',
];

export const DEFAULT_EASING: Easing = { kind: 'preset', name: 'smooth', intensity: 0.5 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const easeInOutPow = (p: number, k: number) =>
  p < 0.5 ? Math.pow(2 * p, k) / 2 : 1 - Math.pow(2 * (1 - p), k) / 2;

const easeOutBounce = (p: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) {
    return n * p * p;
  }
  if (p < 2 / d) {
    const q = p - 1.5 / d;
    return n * q * q + 0.75;
  }
  if (p < 2.5 / d) {
    const q = p - 2.25 / d;
    return n * q * q + 0.9375;
  }
  const q = p - 2.625 / d;
  return n * q * q + 0.984375;
};

function applyPreset(name: EasePreset, intensity: number, p: number): number {
  const i = clamp01(intensity);
  switch (name) {
    case 'linear':
      return p;
    case 'hold':
      return p >= 1 ? 1 : 0;
    case 'smooth':
      return easeInOutPow(p, 2 + 2 * i);
    case 'gentle': {
      const sine = -(Math.cos(Math.PI * p) - 1) / 2;
      return p + (sine - p) * (0.4 + 0.6 * i);
    }
    case 'snappy':
      return easeInOutPow(p, 4 + 6 * i);
    case 'slowDown':
      return 1 - Math.pow(1 - p, 2 + 4 * i);
    case 'speedUp':
      return Math.pow(p, 2 + 4 * i);
    case 'overshoot': {
      const s = 0.8 + 2.4 * i;
      const q = p - 1;
      return 1 + (s + 1) * q * q * q + s * q * q;
    }
    case 'bounce': {
      const out = 1 - Math.pow(1 - p, 3);
      return out + (easeOutBounce(p) - out) * (0.4 + 0.6 * i);
    }
    case 'elastic': {
      if (p === 0 || p === 1) {
        return p;
      }
      const period = 0.45 - 0.25 * i;
      return Math.pow(2, -10 * p) * Math.sin(((p - period / 4) * (2 * Math.PI)) / period) + 1;
    }
  }
}

/** Solves a CSS cubic-bezier(x1, y1, x2, y2) for y at x = p. */
function applyBezier(x1: number, y1: number, x2: number, y2: number, p: number): number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;

  let s = p;
  for (let n = 0; n < 8; n++) {
    const err = sampleX(s) - p;
    const d = slopeX(s);
    if (Math.abs(err) < 1e-7) {
      return sampleY(s);
    }
    if (Math.abs(d) < 1e-6) {
      break;
    }
    s -= err / d;
  }
  // Newton stalled — fall back to bisection, which always converges.
  let lo = 0;
  let hi = 1;
  s = p;
  for (let n = 0; n < 30; n++) {
    const x = sampleX(s);
    if (Math.abs(x - p) < 1e-7) {
      break;
    }
    if (x < p) {
      lo = s;
    } else {
      hi = s;
    }
    s = (lo + hi) / 2;
  }
  return sampleY(s);
}

/** Maps linear progress (0–1) through an easing curve. */
export function applyEasing(ease: Easing, progress: number): number {
  const p = clamp01(progress);
  if (ease.kind === 'bezier') {
    return applyBezier(ease.x1, ease.y1, ease.x2, ease.y2, p);
  }
  return applyPreset(ease.name, ease.intensity, p);
}
