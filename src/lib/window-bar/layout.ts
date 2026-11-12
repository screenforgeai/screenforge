/**
 * Lays the bar out as a short list of vector shapes, in CSS px of a window
 * `width` wide. One layout feeds every output: `drawWindowBar` paints it on
 * a canvas (editor preview, video export) and `windowBarSvg` writes it as
 * SVG (captures), so all three look the same.
 */
import { centerText, showsLock, splitUrl } from './page';
import { fitAddress, fitEnd, measureText } from './text';
import {
  BASE_BAR_HEIGHT,
  MAC_DOT_COLORS,
  MAC_DOT_EDGE,
  MAX_BAR_HEIGHT,
  MIN_BAR_HEIGHT,
  REFERENCE_WINDOW_WIDTH,
  WINDOW_BAR_COLORS,
  type WindowBarColors,
} from './tokens';
import type {
  ResolvedWindowBarTheme,
  WindowBarPage,
  WindowBarSettings,
  WindowBarStyle,
} from './types';

export type WindowBarOp =
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      r: number;
      fill: string;
      /** Drawn inside the rect's edge, like a CSS border. */
      stroke?: string;
      strokeWidth?: number;
    }
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      fill: string;
      /** Drawn inside the circle's edge. */
      stroke?: string;
      strokeWidth?: number;
    }
  | {
      /** A line icon: an SVG path in a `box`-unit square, drawn `size` px wide at x, y. */
      kind: 'icon';
      d: string;
      box: number;
      x: number;
      y: number;
      size: number;
      color: string;
      /** In box units. */
      strokeWidth: number;
      alpha: number;
    }
  | {
      kind: 'text';
      x: number;
      /** Alphabetic baseline. */
      y: number;
      text: string;
      size: number;
      color: string;
      align: 'left' | 'center';
      alpha: number;
    };

export interface WindowBarScene {
  width: number;
  height: number;
  ops: WindowBarOp[];
}

export interface WindowBarLayoutInput {
  settings: WindowBarSettings;
  theme: ResolvedWindowBarTheme;
  /** The window's width (bar and page), in the units the bar is drawn in. */
  width: number;
  /** The page on screen. */
  page?: WindowBarPage | null;
  /** The page fading out during a page change, and how far the change is (0–1). */
  previousPage?: WindowBarPage | null;
  mix?: number;
  /** 9:16: dots and domain only, no address box. */
  compact?: boolean;
}

/** Inter's baseline sits this far (in em) below the middle of a line. */
const BASELINE_FROM_MIDDLE = 0.36;

const LOCK_ICON =
  'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z' +
  'M8 11V7a4 4 0 0 1 8 0v4';
const BACK_ICON = 'M15 18l-6-6 6-6';
const FORWARD_ICON = 'M9 18l6-6-6-6';
const RELOAD_ICON = 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5';
const MINIMIZE_ICON = 'M0 5h10';
const MAXIMIZE_ICON = 'M0.5 0.5h9v9h-9z';
const CLOSE_ICON = 'M0 0l10 10M10 0L0 10';

/** How tall the bar is over a window `width` wide: its base height scaled by width/1280, kept to 24–72. */
export function windowBarHeight(style: WindowBarStyle, width: number): number {
  if (style === 'none') {
    return 0;
  }
  const base = BASE_BAR_HEIGHT[style];
  return Math.min(
    MAX_BAR_HEIGHT,
    Math.max(MIN_BAR_HEIGHT, (base * width) / REFERENCE_WINDOW_WIDTH),
  );
}

interface Ctx {
  ops: WindowBarOp[];
  colors: WindowBarColors;
  /** Multiplier from the reference sizes to this bar. */
  k: number;
  height: number;
  width: number;
}

function textOp(c: Ctx, x: number, text: string, align: 'left' | 'center', alpha: number): void {
  if (!text || alpha <= 0) {
    return;
  }
  const size = 12 * c.k;
  c.ops.push({
    kind: 'text',
    x,
    y: c.height / 2 + BASELINE_FROM_MIDDLE * size,
    text,
    size,
    color: c.colors.text,
    align,
    alpha,
  });
}

function lockOp(c: Ctx, x: number, alpha: number): void {
  if (alpha <= 0) {
    return;
  }
  const size = 10 * c.k;
  c.ops.push({
    kind: 'icon',
    d: LOCK_ICON,
    box: 24,
    x,
    y: c.height / 2 - size / 2,
    size,
    color: c.colors.text,
    strokeWidth: 2.6,
    alpha: alpha * 0.8,
  });
}

/** A line of text with an optional lock in front, fitted to `maxWidth` and placed at `x` (left) or centered on it. */
function labelOps(
  c: Ctx,
  text: string,
  lock: boolean,
  x: number,
  maxWidth: number,
  align: 'left' | 'center',
  alpha: number,
  fit: (text: string, width: number, size: number) => string,
): void {
  if (alpha <= 0) {
    return;
  }
  const size = 12 * c.k;
  const lockSpace = lock ? 16 * c.k : 0;
  const fitted = text ? fit(text, Math.max(0, maxWidth - lockSpace), size) : '';
  // No words, no lock: an empty address box stays empty.
  if (!fitted) {
    return;
  }
  const groupWidth = lockSpace + measureText(fitted, size);
  const left = align === 'center' ? x - groupWidth / 2 : x;
  if (lock) {
    lockOp(c, left, alpha);
  }
  textOp(c, left + lockSpace, fitted, 'left', alpha);
}

function iconOp(
  c: Ctx,
  d: string,
  box: number,
  x: number,
  size: number,
  strokeWidth: number,
  color: string,
): void {
  c.ops.push({
    kind: 'icon',
    d,
    box,
    x,
    y: c.height / 2 - size / 2,
    size,
    color,
    strokeWidth,
    alpha: 1,
  });
}

function dotsOps(c: Ctx): number {
  const r = 6 * c.k;
  const edge = 0.5 * c.k;
  let x = 14 * c.k;
  for (const color of MAC_DOT_COLORS) {
    c.ops.push({
      kind: 'circle',
      cx: x + r,
      cy: c.height / 2,
      r,
      fill: color,
      stroke: MAC_DOT_EDGE,
      strokeWidth: edge,
    });
    x += 2 * r + 8 * c.k;
  }
  // Right edge of the last dot.
  return x - 8 * c.k;
}

/** Each page's text, with the old page fading out while the new one fades in. */
function pages(input: WindowBarLayoutInput): { text: string; alpha: number }[] {
  const mix = input.previousPage ? Math.min(1, Math.max(0, input.mix ?? 1)) : 1;
  const current = { text: textFor(input, input.page), alpha: mix };
  if (mix >= 1) {
    return [current];
  }
  const previous = { text: textFor(input, input.previousPage), alpha: 1 - mix };
  // The same words on both pages don't fade.
  if (previous.text === current.text) {
    return [{ text: current.text, alpha: 1 }];
  }
  return [previous, current];
}

function textFor(input: WindowBarLayoutInput, page: WindowBarPage | null | undefined): string {
  if (input.compact && input.settings.style !== 'windows') {
    // A vertical video has no room for a path: the domain only.
    if (input.settings.center === 'url' || input.settings.center === 'domain') {
      return page?.url ? splitUrl(page.url).host : '';
    }
  }
  return centerText(input.settings, page);
}

function fitFor(
  input: WindowBarLayoutInput,
): (text: string, width: number, size: number) => string {
  return input.settings.center === 'url' || input.settings.center === 'domain'
    ? fitAddress
    : fitEnd;
}

export function layoutWindowBar(input: WindowBarLayoutInput): WindowBarScene {
  const { settings, width } = input;
  if (settings.style === 'none' || width <= 0) {
    return { width, height: 0, ops: [] };
  }

  const height = windowBarHeight(settings.style, width);
  const k = height / BASE_BAR_HEIGHT[settings.style];
  const colors = WINDOW_BAR_COLORS[input.theme];
  const c: Ctx = { ops: [], colors, k, height, width };
  const lock = showsLock(settings);
  const hasCenter = settings.center !== 'none';
  const fit = fitFor(input);

  c.ops.push({ kind: 'rect', x: 0, y: 0, w: width, h: height, r: 0, fill: colors.bar });
  const divider = Math.max(1, k);
  c.ops.push({
    kind: 'rect',
    x: 0,
    y: height - divider,
    w: width,
    h: divider,
    r: 0,
    fill: colors.divider,
  });

  if (settings.style === 'windows') {
    const controls = 46 * k;
    const textLeft = 14 * k;
    const maxText = width - textLeft - 3 * controls - 8 * k;
    for (const page of pages(input)) {
      labelOps(c, page.text, false, textLeft, maxText, 'left', page.alpha, fit);
    }
    const icon = 10 * k;
    [MINIMIZE_ICON, MAXIMIZE_ICON, CLOSE_ICON].forEach((d, i) => {
      const left = width - (3 - i) * controls;
      iconOp(c, d, 10, left + (controls - icon) / 2, icon, 1, colors.text);
    });
    return { width, height, ops: c.ops };
  }

  if (settings.style === 'mac') {
    const dotsRight = dotsOps(c);
    if (!hasCenter) {
      return { width, height, ops: c.ops };
    }
    if (input.compact) {
      // Centered in the bar, kept clear of the dots on both sides.
      const room = width - 2 * (dotsRight + 8 * k);
      for (const page of pages(input)) {
        labelOps(c, page.text, false, width / 2, room, 'center', page.alpha, fit);
      }
      return { width, height, ops: c.ops };
    }
    // A fixed 44% box, so it never jumps as the address changes.
    const boxWidth = width * 0.44;
    const boxHeight = 24 * k;
    const boxX = (width - boxWidth) / 2;
    c.ops.push({
      kind: 'rect',
      x: boxX,
      y: (height - boxHeight) / 2,
      w: boxWidth,
      h: boxHeight,
      r: 6 * k,
      fill: colors.address,
      stroke: colors.addressEdge,
      strokeWidth: Math.max(1, k),
    });
    for (const page of pages(input)) {
      labelOps(c, page.text, lock, width / 2, boxWidth - 20 * k, 'center', page.alpha, fit);
    }
    return { width, height, ops: c.ops };
  }

  // Browser.
  if (input.compact) {
    if (hasCenter) {
      for (const page of pages(input)) {
        labelOps(c, page.text, lock, width / 2, width - 28 * k, 'center', page.alpha, fit);
      }
    }
    return { width, height, ops: c.ops };
  }
  const icon = 14 * k;
  let x = 14 * k;
  for (const d of [BACK_ICON, FORWARD_ICON, RELOAD_ICON]) {
    iconOp(c, d, 24, x, icon, 2, colors.icon);
    x += icon + 12 * k;
  }
  const fieldX = x - 12 * k + 14 * k;
  const fieldWidth = Math.max(0, width - 14 * k - fieldX);
  const fieldHeight = 26 * k;
  c.ops.push({
    kind: 'rect',
    x: fieldX,
    y: (height - fieldHeight) / 2,
    w: fieldWidth,
    h: fieldHeight,
    r: 13 * k,
    fill: colors.address,
    stroke: colors.addressEdge,
    strokeWidth: Math.max(1, k),
  });
  if (hasCenter) {
    for (const page of pages(input)) {
      labelOps(c, page.text, lock, fieldX + 12 * k, fieldWidth - 24 * k, 'left', page.alpha, fit);
    }
  }
  return { width, height, ops: c.ops };
}
