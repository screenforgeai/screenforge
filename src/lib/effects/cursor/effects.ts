/**
 * Click and cursor effects beyond the original ripple.
 *
 * Everything here is a pure function of the click times, the current time and the
 * cursor path, so a frame looks the same however you reach it: playing, scrubbing,
 * seeking, or exporting frame by frame. Sizes are in cursor draw units and are
 * multiplied by `scale` (canvas pixels per draw unit), so effects grow with the
 * cursor size setting and the export resolution.
 */
import { drawStar, hash01 } from './styles';

export const CURSOR_CLICK_EFFECTS = ['none', 'ripple', 'pulse', 'sparkle', 'confetti'] as const;
export type CursorClickEffect = (typeof CURSOR_CLICK_EFFECTS)[number];

export const CURSOR_EFFECTS = ['none', 'highlight', 'spotlight', 'magnifier', 'glitter'] as const;
export type CursorEffect = (typeof CURSOR_EFFECTS)[number];

export const CLICK_EFFECT_DURATION: Record<Exclude<CursorClickEffect, 'none'>, number> = {
  ripple: 0.45,
  pulse: 0.55,
  sparkle: 0.7,
  confetti: 1.1,
};
export const MAX_CLICK_EFFECT_DURATION = Math.max(...Object.values(CLICK_EFFECT_DURATION));

/** How far the cursor shrinks while pressed: the default subtle press, or "Shrink on click". */
export const PRESS_SCALE = 0.95;
export const SHRINK_PRESS_SCALE = 0.8;

export const MAGNIFIER_RADIUS = 66;
export const MAGNIFIER_ZOOM = 1.9;

export function normalizeCursorClickEffect(value: unknown): CursorClickEffect {
  return (CURSOR_CLICK_EFFECTS as readonly unknown[]).includes(value)
    ? (value as CursorClickEffect)
    : 'none';
}

export function normalizeCursorEffect(value: unknown): CursorEffect {
  return (CURSOR_EFFECTS as readonly unknown[]).includes(value) ? (value as CursorEffect) : 'none';
}

export interface EffectParticle {
  x: number;
  y: number;
  size: number;
  rotation: number;
  alpha: number;
  color: string;
  shape: 'star' | 'confetti';
}

const GLITTER_COLORS = ['#F5B700', '#FFCF40', '#FF8AD8', '#A78BFA', '#FFE58A'];
const CONFETTI_COLORS = ['#2F6FED', '#F2552C', '#16A34A', '#F5B700', '#7C5CFF'];

const SPARKLE_COUNT = 10;
const SPARKLE_DRAG = 4.2;
const CONFETTI_COUNT = 16;
const CONFETTI_GRAVITY = 310;

/** Particles for one click, as offsets from the click point. Empty once the effect is over. */
export function getClickParticles(
  effect: 'sparkle' | 'confetti',
  seed: number,
  age: number,
  scale: number,
): EffectParticle[] {
  const duration = CLICK_EFFECT_DURATION[effect];
  if (age < 0 || age > duration) {
    return [];
  }
  const life = 1 - age / duration;
  const particles: EffectParticle[] = [];

  if (effect === 'sparkle') {
    // Exact solution of velocity with linear drag: distance = v (1 - e^(-k·age)) / k.
    const travelled = (1 - Math.exp(-SPARKLE_DRAG * age)) / SPARKLE_DRAG;
    for (let j = 0; j < SPARKLE_COUNT; j++) {
      const angle = (j / SPARKLE_COUNT) * Math.PI * 2 + (hash01(seed, j * 5 + 1) - 0.5) * 0.4;
      const speed = 110 + hash01(seed, j * 5 + 2) * 70;
      const twinkle = 0.65 + 0.35 * Math.sin(age * 25 + hash01(seed, j * 5 + 3) * 6.28);
      particles.push({
        x: Math.cos(angle) * speed * travelled * scale,
        y: Math.sin(angle) * speed * travelled * scale,
        size: (3.5 + hash01(seed, j * 5 + 4) * 3.2) * (0.6 + 0.4 * life) * scale,
        rotation: 0,
        alpha: life * twinkle,
        color: GLITTER_COLORS[j % GLITTER_COLORS.length],
        shape: 'star',
      });
    }
    return particles;
  }

  for (let j = 0; j < CONFETTI_COUNT; j++) {
    const angle = -Math.PI / 2 + (hash01(seed, j * 7 + 1) - 0.5) * 2.4;
    const speed = 100 + hash01(seed, j * 7 + 2) * 85;
    const spin = (hash01(seed, j * 7 + 3) - 0.5) * 12;
    particles.push({
      x: Math.cos(angle) * speed * age * scale,
      y: (Math.sin(angle) * speed * age + 0.5 * CONFETTI_GRAVITY * age * age) * scale,
      size: 8 * scale,
      rotation: hash01(seed, j * 7 + 4) * 6.28 + spin * age,
      alpha: Math.min(1, life * 2),
      color: CONFETTI_COLORS[j % CONFETTI_COLORS.length],
      shape: 'confetti',
    });
  }
  return particles;
}

/** A filled dot that swells and fades from the click point. */
export function getPulse(age: number, scale: number): { radius: number; alpha: number } | null {
  const duration = CLICK_EFFECT_DURATION.pulse;
  if (age < 0 || age > duration) {
    return null;
  }
  const p = age / duration;
  const eased = 1 - (1 - p) * (1 - p);
  return { radius: (8 + eased * 24) * scale, alpha: 0.5 * (1 - p) };
}

/** Indices of clicks with `t - window <= click.t <= t`, oldest first. */
export function findClicksInWindow(clicks: { t: number }[], t: number, window: number): number[] {
  let lo = 0;
  let hi = clicks.length;
  const from = t - window;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (clicks[mid].t < from) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const result: number[] = [];
  for (let i = lo; i < clicks.length && clicks[i].t <= t; i++) {
    result.push(i);
  }
  return result;
}

const TRAIL_SPAWN_INTERVAL = 1 / 90;
const TRAIL_LIFE = 0.8;
const TRAIL_SPEED_PROBE = 0.03;
const TRAIL_MIN_SPEED = 60;

/**
 * Glitter left behind a moving cursor. Sparkles are "born" on a fixed time grid at
 * wherever the cursor was then, so they don't depend on frame rate or playback
 * history. `pointAt(s)` returns the cursor's canvas position at time s.
 */
export function getTrailParticles(
  t: number,
  pointAt: (s: number) => { x: number; y: number } | null,
  scale: number,
): EffectParticle[] {
  const particles: EffectParticle[] = [];
  const first = Math.floor((t - TRAIL_LIFE) / TRAIL_SPAWN_INTERVAL) + 1;
  const last = Math.floor(t / TRAIL_SPAWN_INTERVAL);
  for (let k = Math.max(first, 0); k <= last; k++) {
    const born = k * TRAIL_SPAWN_INTERVAL;
    const age = t - born;
    const at = pointAt(born);
    const before = pointAt(born - TRAIL_SPEED_PROBE);
    if (!at || !before) {
      continue;
    }
    const speed = Math.hypot(at.x - before.x, at.y - before.y) / TRAIL_SPEED_PROBE;
    if (speed < TRAIL_MIN_SPEED * scale) {
      continue;
    }
    const life = 1 - age / TRAIL_LIFE;
    for (let j = 0; j < 2; j++) {
      const n = (i: number) => hash01(k, j * 8 + i);
      particles.push({
        x: at.x + ((n(1) - 0.5) * 12 + (n(2) - 0.5) * 10 * age) * scale,
        y: at.y + ((n(3) - 0.5) * 12 + (12 + n(4) * 24) * age) * scale,
        size: (2.2 + n(5) * 3.6) * (0.6 + 0.4 * life) * scale,
        rotation: 0,
        alpha: life * (0.65 + 0.35 * Math.sin(age * 25 + n(6) * 6.28)),
        color: GLITTER_COLORS[Math.floor(n(7) * GLITTER_COLORS.length)],
        shape: 'star',
      });
    }
  }
  return particles;
}

const SPOTLIGHT_RADIUS = 68;
const SPOTLIGHT_TIGHTEN = 0.18;
const SPOTLIGHT_TIGHTEN_DURATION = 0.35;

/** Spotlight radius: it pulls in a little on each click, drawing the eye to it. */
export function getSpotlightRadius(scale: number, sinceClick: number | null): number {
  let factor = 1;
  if (sinceClick !== null && sinceClick >= 0 && sinceClick < SPOTLIGHT_TIGHTEN_DURATION) {
    factor -= SPOTLIGHT_TIGHTEN * Math.sin((Math.PI * sinceClick) / SPOTLIGHT_TIGHTEN_DURATION);
  }
  return SPOTLIGHT_RADIUS * scale * factor;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

export function drawParticles(ctx: CanvasRenderingContext2D, particles: EffectParticle[]): void {
  for (const p of particles) {
    if (p.alpha <= 0) {
      continue;
    }
    ctx.globalAlpha = Math.min(1, p.alpha);
    ctx.fillStyle = p.color;
    if (p.shape === 'star') {
      drawStar(ctx, p.x, p.y, p.size);
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}

/** The original click ripple, for canvas previews (Pixi draws its own rings). */
export function drawRipple(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  age: number,
  scale: number,
): void {
  const progress = age / CLICK_EFFECT_DURATION.ripple;
  if (progress < 0 || progress > 1) {
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 32 * scale * progress, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 255, 255, ${(1 - progress) * 0.55})`;
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();
  ctx.restore();
}

export interface CursorEffectsFrame {
  t: number;
  /** Canvas pixels per cursor draw unit. */
  scale: number;
  width: number;
  height: number;
  clickEffect: CursorClickEffect;
  cursorEffect: CursorEffect;
  /** The cursor's hotspot on the canvas, or null while it is hidden. */
  cursor: { x: number; y: number } | null;
  /** Clicks still playing their effect, in canvas space. */
  clicks: { x: number; y: number; t: number; seed: number }[];
  /** Cursor position at an earlier time, for the glitter trail. */
  pointAt?: (s: number) => { x: number; y: number } | null;
  /** Seconds since the latest click, for the spotlight's tighten. */
  sinceClick: number | null;
}

/**
 * Draws the spotlight, highlight, glitter trail and the non-ripple click effects
 * onto an otherwise empty overlay canvas. The spotlight cuts its hole with
 * `destination-out`, so it must be first on a layer of its own (which this is).
 */
export function drawCursorEffects(ctx: CanvasRenderingContext2D, frame: CursorEffectsFrame): void {
  const { scale, cursor } = frame;

  if (frame.cursorEffect === 'spotlight' && cursor) {
    const r = getSpotlightRadius(scale, frame.sinceClick);
    const cx = cursor.x + 6 * scale;
    const cy = cursor.y + 9 * scale;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.globalCompositeOperation = 'destination-out';
    const hole = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.25);
    hole.addColorStop(0, 'rgba(0,0,0,1)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = hole;
    ctx.fillRect(cx - r * 1.3, cy - r * 1.3, r * 2.6, r * 2.6);
    ctx.restore();
  }

  if (frame.cursorEffect === 'highlight' && cursor) {
    ctx.save();
    ctx.fillStyle = 'rgba(239,159,39,0.35)';
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 32 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (frame.cursorEffect === 'glitter' && frame.pointAt) {
    drawParticles(ctx, getTrailParticles(frame.t, frame.pointAt, scale));
  }

  for (const click of frame.clicks) {
    const age = frame.t - click.t;
    if (frame.clickEffect === 'pulse') {
      const pulse = getPulse(age, scale);
      if (pulse) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(click.x, click.y, pulse.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${pulse.alpha})`;
        ctx.fill();
        ctx.lineWidth = 1.2 * scale;
        ctx.strokeStyle = `rgba(0,0,0,${pulse.alpha * 0.25})`;
        ctx.stroke();
        ctx.restore();
      }
    } else if (frame.clickEffect === 'sparkle' || frame.clickEffect === 'confetti') {
      const particles = getClickParticles(frame.clickEffect, click.seed, age, scale);
      ctx.save();
      ctx.translate(click.x, click.y);
      drawParticles(ctx, particles);
      ctx.restore();
    }
  }
}

/** True when this frame needs the overlay canvas at all. */
export function needsEffectsOverlay(
  clickEffect: CursorClickEffect,
  cursorEffect: CursorEffect,
): boolean {
  return (
    clickEffect === 'pulse' ||
    clickEffect === 'sparkle' ||
    clickEffect === 'confetti' ||
    cursorEffect === 'highlight' ||
    cursorEffect === 'spotlight' ||
    cursorEffect === 'glitter'
  );
}
