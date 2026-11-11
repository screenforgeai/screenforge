/**
 * Vector cursor styles. Every style except the original macOS cursor (cursor01,
 * drawn from its SVG assets) is drawn here with Canvas 2D, so the same code paints
 * the editor's previews and the Pixi textures used for the preview and the export.
 *
 * Coordinates are "draw units": the cursor01 image is 52 units square, and every
 * style is drawn with its hotspot at (0, 0) so it lands exactly where the
 * original cursor would.
 */

export const CURSOR_STYLE_IDS = [
  'cursor01',
  'macos-white',
  'windows',
  'touch',
  'wedge',
  'collaborator',
  'rounded',
  'gradient',
  'glitter',
  'glass',
  'sparkle',
] as const;

export type CursorStyleId = (typeof CURSOR_STYLE_IDS)[number];
export type VectorCursorStyleId = Exclude<CursorStyleId, 'cursor01'>;
export type CursorDrawState = 'default' | 'pointer' | 'text';

export const CURSOR_STYLE_GROUPS: {
  id: 'standard' | 'modern' | 'decorative';
  styles: CursorStyleId[];
}[] = [
  { id: 'standard', styles: ['cursor01', 'macos-white', 'windows', 'touch'] },
  { id: 'modern', styles: ['wedge', 'collaborator', 'rounded'] },
  { id: 'decorative', styles: ['gradient', 'glitter', 'glass', 'sparkle'] },
];

/** Colours offered for the name-tag cursors; the first is the default. */
export const CURSOR_COLOR_OPTIONS = [
  '#1D9BF0',
  '#2F6FED',
  '#7C5CFF',
  '#16A34A',
  '#F2552C',
  '#E5484D',
  '#111114',
] as const;
export const DEFAULT_CURSOR_COLOR: string = CURSOR_COLOR_OPTIONS[0];
export const DEFAULT_CURSOR_LABEL = 'You';
export const CURSOR_LABEL_MAX_LENGTH = 18;

export function normalizeCursorStyle(value: unknown): CursorStyleId {
  return (CURSOR_STYLE_IDS as readonly unknown[]).includes(value)
    ? (value as CursorStyleId)
    : 'cursor01';
}

export function normalizeCursorColor(value: unknown): string {
  return (CURSOR_COLOR_OPTIONS as readonly unknown[]).includes(value)
    ? (value as string)
    : DEFAULT_CURSOR_COLOR;
}

export function normalizeCursorLabel(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_CURSOR_LABEL;
  }
  return value.trim().slice(0, CURSOR_LABEL_MAX_LENGTH);
}

/** Styles whose look changes over time (twinkles) and must be redrawn each frame. */
export function isAnimatedCursorStyle(style: CursorStyleId): boolean {
  return style === 'glitter' || style === 'sparkle';
}

/** Styles that carry a name tag and take the cursor colour and name settings. */
export function isNameTagCursorStyle(style: CursorStyleId): boolean {
  return style === 'collaborator' || style === 'rounded';
}

/** Styles that look different while the mouse button is down. */
export function cursorStyleReactsToPress(style: CursorStyleId): boolean {
  return style === 'touch';
}

export interface CursorDrawOptions {
  /** Seconds; drives the twinkle of animated styles. */
  time: number;
  /** Collaborator cursor colour. */
  color: string;
  /** Collaborator name tag. */
  label: string;
  pressed: boolean;
}

export const DEFAULT_CURSOR_DRAW_OPTIONS: CursorDrawOptions = {
  time: 0,
  color: DEFAULT_CURSOR_COLOR,
  label: DEFAULT_CURSOR_LABEL,
  pressed: false,
};

// ── Geometry ─────────────────────────────────────────────────────────────────

const MAC_ARROW_OUTER =
  'm7 .014a2 2 0 0 0-2 2.003l.026 18.127a2.003 2.003 0 0 0 1.999 1.998c.5 0 .991-.188 1.369-.541l2.463-2.311l2.377 5.516a2.006 2.006 0 0 0 1.836 1.208c.274 0 .549-.057.806-.169l2.406-1.059a1.998 1.998 0 0 0 1.013-2.661l-2.498-5.47l3.544-.322a1.998 1.998 0 0 0 1.187-3.451L8.367.554A1.999 1.999 0 0 0 7 .014z';
const MAC_ARROW_INNER =
  'm7 2.014l13.162 12.328l-5.377.488l-.977.088l.406.894l3.263 7.145l-2.406 1.058l-3.113-7.222l-.391-.91l-.722.678l-3.819 3.582L7 2.014z';
const HAND_BODY =
  'M149 59V283L120.5 248.5C47.3001 220.9 39.3334 284.333 44.5001 319.5L188 492.5H429.5L468.5 365C473.5 332.333 482.7 258.7 479.5 225.5C476.3 192.3 427.833 186.667 404 188C391.2 164.4 344 163.833 322 166.5C298 148.5 266.667 159 254 166.5V59C213.586 -11 167.161 29.8333 149 59Z';
const HAND_LINES =
  'M201.143 36.5714C191.048 36.5714 182.428 40.1429 175.286 47.2857C168.143 54.4286 164.571 63.0476 164.571 73.1429V329.143L121.429 271.429C113.619 261.143 103.429 256 90.8571 256C80.9523 256 72.4761 259.619 65.4285 266.857C58.3809 274.095 54.8571 282.667 54.8571 292.571C54.8571 300.762 57.3333 308.095 62.2856 314.571L172 460.857C179.238 470.571 188.952 475.429 201.143 475.429H406.286C410.476 475.429 414.238 474.143 417.571 471.571C420.905 469 423.048 465.714 424 461.714L450.286 356.571C454.857 338.286 457.143 319.81 457.143 301.143V239.143C457.143 231.333 454.476 224.571 449.143 218.857C443.809 213.143 437.333 210.286 429.714 210.286C422.095 210.286 415.619 212.952 410.286 218.286C404.952 223.619 402.286 230.095 402.286 237.714H393.143V220.286C393.143 211.143 390.095 203.381 384 197C377.905 190.619 370.286 187.429 361.143 187.429C352.381 187.429 344.857 190.571 338.571 196.857C332.286 203.143 329.143 210.667 329.143 219.429V237.714H320V212C320 201.524 316.476 192.524 309.429 185C302.381 177.476 293.714 173.714 283.429 173.714C273.333 173.714 264.714 177.286 257.571 184.429C250.429 191.571 246.857 200.19 246.857 210.286V237.714H237.714V74.8571C237.714 64.381 234.19 55.381 227.143 47.8571C220.095 40.3333 211.429 36.5714 201.143 36.5714ZM201.143 0C221.524 0 238.809 7.38095 253 22.1429C267.19 36.9048 274.286 54.4762 274.286 74.8571V137.714C278.476 137.333 281.524 137.143 283.429 137.143C302.286 137.143 318.762 143.714 332.857 156.857C341.809 152.857 351.238 150.857 361.143 150.857C382.667 150.857 400.19 159.143 413.714 175.714C418.857 174.381 424.19 173.714 429.714 173.714C447.619 173.714 462.762 180.143 475.143 193C487.524 205.857 493.714 221.238 493.714 239.143V301.143C493.714 323.238 491.048 344.667 485.714 365.429L459.429 470.571C456.381 482.762 449.905 492.714 440 500.429C430.095 508.143 418.857 512 406.286 512H201.143C189.714 512 178.809 509.381 168.429 504.143C158.048 498.905 149.429 491.81 142.571 482.857L32.8571 336.571C23.1428 323.619 18.2856 308.952 18.2856 292.571C18.2856 272.571 25.3809 255.381 39.5714 241C53.7618 226.619 70.8571 219.429 90.8571 219.429C104.381 219.429 116.762 222.762 128 229.429V73.1429C128 52.9524 135.143 35.7143 149.429 21.4286C163.714 7.14286 180.952 0 201.143 0ZM237.714 402.286V292.571H228.571V402.286H237.714ZM310.857 402.286V292.571H301.714V402.286H310.857ZM384 402.286V292.571H374.857V402.286H384Z';
const I_BEAM =
  'M192.012 68L193.459 68.0127C208.402 68.2588 223.067 72.1416 236.184 79.335C243.444 83.3166 250.103 88.2444 256 93.9648C261.897 88.2444 268.556 83.3166 275.816 79.335C289.356 71.9095 304.546 68.0114 319.988 68H352C359.426 68 366.548 70.9502 371.799 76.2012C377.05 81.4522 380 88.574 380 96C380 103.426 377.05 110.548 371.799 115.799C366.548 121.05 359.426 124 352 124H320C310.452 124 301.295 127.793 294.544 134.544C287.793 141.295 284 150.452 284 160V228H304C311.194 228 318.103 230.769 323.302 235.716L323.799 236.201L324.284 236.699C329.231 241.898 332 248.806 332 256C332 263.426 329.05 270.548 323.799 275.799C318.548 281.05 311.426 284 304 284H284V352C284 361.548 287.793 370.705 294.544 377.456C301.295 384.207 310.452 388 320 388H352C359.194 388 366.102 390.769 371.301 395.716L371.799 396.201L372.284 396.698C377.231 401.897 380 408.806 380 416C380 423.426 377.05 430.548 371.799 435.799C366.548 441.05 359.426 444 352 444H319.988C304.546 443.989 289.356 440.091 275.816 432.665C268.556 428.683 261.897 423.755 256 418.034C250.103 423.755 243.444 428.683 236.184 432.665C222.644 440.091 207.454 443.989 192.012 444H160C152.574 444 145.452 441.05 140.201 435.799C134.95 430.548 132 423.426 132 416C132 408.574 134.95 401.452 140.201 396.201L140.699 395.716C145.898 390.769 152.806 388 160 388H192C201.548 388 210.705 384.207 217.456 377.456C224.207 370.705 228 361.548 228 352V284H208C200.574 284 193.452 281.05 188.201 275.799C182.95 270.548 180 263.426 180 256C180 248.574 182.95 241.452 188.201 236.201L188.698 235.716C193.897 230.769 200.806 228 208 228H228V160C228 150.452 224.207 141.295 217.456 134.544C210.705 127.793 201.548 124 192 124H160C152.574 124 145.452 121.05 140.201 115.799C134.95 110.548 132 103.426 132 96C132 88.5739 134.95 81.4522 140.201 76.2012C145.452 70.9502 152.574 68 160 68H192.012Z';
const ARROW = 'M3 1.5V23.5L8.4 18.6L12 27.2L15.4 25.8L11.8 17.4H19Z';
const WEDGE = 'M3.5 2.8L21 10.2L12.6 12.6L10.2 21Z';
const WINDOWS_I_BEAM =
  'M8.5 3.5h2.6c.5 0 .9.4.9.9 0-.5.4-.9.9-.9h2.6M12 4.4v15.2M8.5 20.5h2.6c.5 0 .9-.4.9-.9 0 .5.4.9.9.9h2.6';

type Box = [x0: number, y0: number, x1: number, y1: number];

/** A path drawn in its own units, placed in draw units by `tx, ty, s`. */
interface Shape {
  key: string;
  /** Drawn first. */
  first: string;
  /** Drawn on top of `first` (outline lines, or the inner body of the mac arrow). */
  second?: string;
  /** Which layer takes the style's finish; the other is the outline. */
  finishOn: 'first' | 'second';
  /** Outline stroke width (path units) for shapes without a second layer. */
  stroke: number;
  box: Box;
  tx: number;
  ty: number;
  s: number;
}

// cursor01's hotspots, so every style lands exactly where the original does.
const ARROW_HOTSPOT = { x: 16.25, y: 3.25 };
const TEXT_HOTSPOT = { x: 21.125, y: 21.125 };

const MAC_ARROW_SHAPE: Shape = {
  key: 'mac-arrow',
  first: MAC_ARROW_OUTER,
  second: MAC_ARROW_INNER,
  finishOn: 'second',
  stroke: 0,
  box: [5, 0, 22.3, 26],
  tx: -ARROW_HOTSPOT.x,
  ty: -ARROW_HOTSPOT.y,
  s: 2,
};
const HAND_SHAPE: Shape = {
  key: 'hand',
  first: HAND_BODY,
  second: HAND_LINES,
  finishOn: 'first',
  stroke: 0,
  box: [18, 0, 494, 512],
  tx: -ARROW_HOTSPOT.x,
  ty: -ARROW_HOTSPOT.y,
  s: 52 / 512,
};
const I_BEAM_SHAPE: Shape = {
  key: 'i-beam',
  first: I_BEAM,
  finishOn: 'first',
  stroke: 32,
  box: [116, 52, 396, 460],
  tx: -TEXT_HOTSPOT.x,
  ty: -TEXT_HOTSPOT.y,
  s: 52 / 512,
};
const ARROW_SCALE = 1.85;
const ARROW_SHAPE: Shape = {
  key: 'arrow',
  first: ARROW,
  finishOn: 'first',
  stroke: 1.4,
  box: [3, 1.5, 19, 27.2],
  tx: -3 * ARROW_SCALE,
  ty: -1.5 * ARROW_SCALE,
  s: ARROW_SCALE,
};
const WEDGE_SCALE = 2.1;
const WEDGE_SHAPE: Shape = {
  key: 'wedge',
  first: WEDGE,
  finishOn: 'first',
  stroke: 1.8,
  box: [3.5, 2.8, 21, 21],
  tx: -3.5 * WEDGE_SCALE,
  ty: -2.8 * WEDGE_SCALE,
  s: WEDGE_SCALE,
};

// ── Pointer angle ────────────────────────────────────────────────────────────
// The dart pointers (Wedge, Collaborator, Rounded) are drawn aiming at 45°, but
// the macOS arrow's axis leans further toward vertical. The tilt-while-moving
// rotation is tuned for the macOS arrow, so the darts are turned about their
// tip to aim along the same axis.

type Vec = [number, number];
/** Direction (radians) from a pointer's tip into its body: the bisector of its two edges. */
function axisOf(tip: Vec, a: Vec, b: Vec): number {
  const ua = Math.hypot(a[0] - tip[0], a[1] - tip[1]);
  const ub = Math.hypot(b[0] - tip[0], b[1] - tip[1]);
  return Math.atan2(
    (a[1] - tip[1]) / ua + (b[1] - tip[1]) / ub,
    (a[0] - tip[0]) / ua + (b[0] - tip[0]) / ub,
  );
}
// macOS arrow (inner body): vertical left edge, right edge to the wing.
const MAC_AXIS = axisOf([7, 2.014], [7, 20.703], [20.162, 14.342]);
const WEDGE_TURN = MAC_AXIS - axisOf([3.5, 2.8], [21, 10.2], [10.2, 21]);
const ROUNDED_TURN = MAC_AXIS - axisOf([3, 3], [24.5, 11.2], [10.6, 24.8]);

/** The axis a style's arrow aims along, after its turn (radians, 0 = pointing right). */
export function getPointerAxis(style: 'cursor01' | 'wedge' | 'collaborator' | 'rounded'): number {
  if (style === 'cursor01') {
    return MAC_AXIS;
  }
  if (style === 'rounded') {
    return axisOf([3, 3], [24.5, 11.2], [10.6, 24.8]) + ROUNDED_TURN;
  }
  return axisOf([3.5, 2.8], [21, 10.2], [10.2, 21]) + WEDGE_TURN;
}

// Path2D does not exist outside a browser (unit tests), so paths are built on use.
const pathCache = new Map<string, Path2D>();
function path(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
}

// ── Finishes ─────────────────────────────────────────────────────────────────

type Finish =
  | { kind: 'solid'; fill: string; outline: string }
  | { kind: 'gradient' }
  | { kind: 'glitter' }
  | { kind: 'glass' };

const GRADIENT_STOPS = ['#7C5CFF', '#FF5CA8', '#FFB547'];
const GLITTER_BASE = ['#3b1d6e', '#6d3fd6', '#b14fd8'];
const GLITTER_SPARKS = ['#ffffff', '#FFE58A', '#FFC2EC', '#C9B8FF'];
const GLITTER_COUNT = 46;

/** Deterministic 0–1 noise, so glitter sits in the same place every frame and export. */
export function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x9e3779b9, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

function diagonalGradient(
  ctx: CanvasRenderingContext2D,
  box: Box,
  stops: string[],
): CanvasGradient {
  const g = ctx.createLinearGradient(box[0], box[1], box[2], box[3]);
  stops.forEach((stop, i) => g.addColorStop(i / (stops.length - 1), stop));
  return g;
}

/** Device pixels per path unit right now, for effects (shadows, filters) that ignore transforms. */
function currentScale(ctx: CanvasRenderingContext2D): number {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b);
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  finish: Finish,
  time: number,
): void {
  ctx.save();
  ctx.translate(shape.tx, shape.ty);
  ctx.scale(shape.s, shape.s);
  ctx.lineJoin = 'round';

  const finishPath = path(shape.finishOn === 'first' ? shape.first : (shape.second ?? shape.first));
  const outlinePath =
    shape.second === undefined
      ? null
      : path(shape.finishOn === 'first' ? shape.second : shape.first);
  const outlineColor =
    finish.kind === 'solid'
      ? finish.outline
      : finish.kind === 'glass'
        ? 'rgba(255,255,255,0.92)'
        : '#ffffff';
  const unit = (shape.box[3] - shape.box[1]) / 26;

  if (finish.kind === 'glass') {
    // Soft drop shadow so the glass reads as floating above the page.
    ctx.save();
    const px = currentScale(ctx);
    ctx.shadowColor = 'rgba(0,0,0,0.42)';
    ctx.shadowBlur = 4.5 * unit * px;
    ctx.shadowOffsetY = 1.8 * unit * px;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill(path(shape.first));
    ctx.restore();
  } else if (finish.kind !== 'solid' && shape.stroke > 0) {
    // Faint dark halo keeps light finishes legible on white pages.
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = shape.stroke * 1.9;
    ctx.stroke(finishPath);
  }

  // The mac arrow paints its white silhouette before the finished inner body.
  if (outlinePath && shape.finishOn === 'second') {
    ctx.fillStyle = outlineColor;
    ctx.fill(outlinePath);
  }

  switch (finish.kind) {
    case 'solid':
      ctx.fillStyle = finish.fill;
      ctx.fill(finishPath);
      break;
    case 'gradient':
      ctx.fillStyle = diagonalGradient(ctx, shape.box, GRADIENT_STOPS);
      ctx.fill(finishPath);
      break;
    case 'glitter': {
      ctx.fillStyle = diagonalGradient(ctx, shape.box, GLITTER_BASE);
      ctx.fill(finishPath);
      ctx.save();
      ctx.clip(finishPath);
      const [x0, y0, x1, y1] = shape.box;
      for (let i = 0; i < GLITTER_COUNT; i++) {
        const x = x0 + hash01(i, 1) * (x1 - x0);
        const y = y0 + hash01(i, 2) * (y1 - y0);
        const r = (0.45 + hash01(i, 3) * 1.15) * unit;
        ctx.globalAlpha = 0.3 + 0.7 * Math.max(0, Math.sin(time * 3 + hash01(i, 4) * 6.28));
        ctx.fillStyle = GLITTER_SPARKS[i % GLITTER_SPARKS.length];
        drawStar(ctx, x, y, r);
      }
      ctx.restore();
      break;
    }
    case 'glass': {
      // A faint cool tint so the glass still reads on a white page.
      ctx.fillStyle = 'rgba(214,220,234,0.5)';
      ctx.fill(finishPath);
      ctx.save();
      ctx.clip(finishPath);
      // Faint rainbow fringe along the edge, like light through real glass.
      const w = Math.max(shape.stroke, unit) * 0.65;
      ctx.lineWidth = w;
      ctx.save();
      ctx.translate(0.25 * unit, 0);
      ctx.strokeStyle = 'rgba(255,70,160,0.4)';
      ctx.stroke(finishPath);
      ctx.translate(-0.5 * unit, 0);
      ctx.strokeStyle = 'rgba(40,200,255,0.4)';
      ctx.stroke(finishPath);
      ctx.restore();
      // Bright rim on the top-left edge, softer on the bottom.
      const [x0, y0, x1, y1] = shape.box;
      const rim = ctx.createLinearGradient(x0, y0, x1, y1);
      rim.addColorStop(0, 'rgba(255,255,255,1)');
      rim.addColorStop(0.55, 'rgba(255,255,255,0.3)');
      rim.addColorStop(1, 'rgba(255,255,255,0.8)');
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(shape.stroke, unit) * 2.2;
      ctx.stroke(finishPath);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(
        x0 + (x1 - x0) * 0.16,
        y0 + (y1 - y0) * 0.3,
        0.9 * unit,
        5 * unit,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
      break;
    }
  }

  if (outlinePath && shape.finishOn === 'first') {
    ctx.fillStyle = outlineColor;
    ctx.fill(outlinePath);
  } else if (!outlinePath && shape.stroke > 0) {
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = finish.kind === 'glass' ? shape.stroke * 0.8 : shape.stroke;
    ctx.stroke(finishPath);
  }
  if (finish.kind === 'glass') {
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(shape.stroke, unit) * 0.45;
    ctx.stroke(path(shape.first));
  }
  ctx.restore();
}

// ── Style table ──────────────────────────────────────────────────────────────

const MAC: Finish = { kind: 'solid', fill: '#000000', outline: '#ffffff' };
const MAC_HAND: Finish = { kind: 'solid', fill: '#ffffff', outline: '#000000' };
const MAC_TEXT: Finish = { kind: 'solid', fill: '#000000', outline: '#ffffff' };
const WHITE: Finish = { kind: 'solid', fill: '#ffffff', outline: '#000000' };
const WHITE_HAND: Finish = { kind: 'solid', fill: '#000000', outline: '#ffffff' };

function finishedShape(
  style: 'gradient' | 'glitter' | 'glass',
  state: CursorDrawState,
): [Shape, Finish] {
  const finish: Finish = { kind: style };
  if (state === 'pointer') {
    return [HAND_SHAPE, finish];
  }
  if (state === 'text') {
    return [I_BEAM_SHAPE, finish];
  }
  return [ARROW_SHAPE, finish];
}

const SPARKLE_COLORS = ['#A78BFA', '#FF8AD8'];
// Where the twinkle sits for each state, in draw units from the hotspot.
const SPARKLE_ANCHOR: Record<CursorDrawState, { x: number; y: number }> = {
  default: { x: 25, y: 0 },
  pointer: { x: 33, y: 1 },
  text: { x: 15, y: -15 },
};

function drawSparkleAccent(ctx: CanvasRenderingContext2D, state: CursorDrawState, time: number) {
  const { x, y } = SPARKLE_ANCHOR[state];
  const a = 0.75 + 0.25 * Math.sin(time * 4);
  const b = 0.6 + 0.4 * Math.sin(time * 4 + 2);
  ctx.save();
  ctx.fillStyle = SPARKLE_COLORS[0];
  drawStar(ctx, x, y, 9.5 * a);
  ctx.fillStyle = SPARKLE_COLORS[1];
  drawStar(ctx, x + 10, y + 12, 5 * b);
  ctx.restore();
}

const TAG_FONT_SIZE = 19;
const TAG_HEIGHT = 31;
const TAG_PADDING_X = 15;
const TAG_X = 24;
const TAG_Y = 34;
const TAG_FONT = `600 ${TAG_FONT_SIZE}px Inter, "SF Pro Text", system-ui, sans-serif`;

function drawNameTag(ctx: CanvasRenderingContext2D, color: string, label: string) {
  if (!label) {
    return;
  }
  ctx.save();
  ctx.font = TAG_FONT;
  const width = ctx.measureText(label).width + TAG_PADDING_X * 2;
  ctx.beginPath();
  ctx.roundRect(TAG_X, TAG_Y, width, TAG_HEIGHT, TAG_HEIGHT / 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, TAG_X + TAG_PADDING_X, TAG_Y + TAG_HEIGHT / 2 + 1);
  ctx.restore();
}

// The rounded pointer: a chunky dart with soft corners, a thick white rim and a
// soft shadow, with a name tag below-right (a rounded rectangle, not a pill).
const ROUNDED_POINTER = 'M3 3L24.5 11.2L14.2 14.6L10.6 24.8Z';
const ROUNDED_SCALE = 1.9;
const ROUNDED_RIM = 5.5;
const ROUNDED_TAG = { x: 32, y: 36, height: 33, radius: 9, padding: 14, fontSize: 20 };
const ROUNDED_TAG_FONT = `600 ${ROUNDED_TAG.fontSize}px Inter, "SF Pro Text", system-ui, sans-serif`;

function drawRoundedPointer(ctx: CanvasRenderingContext2D, color: string) {
  ctx.save();
  ctx.scale(ROUNDED_SCALE, ROUNDED_SCALE);
  ctx.translate(-3, -3);
  ctx.lineJoin = 'round';
  const p = path(ROUNDED_POINTER);
  const px = currentScale(ctx);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 3.5 * px;
  ctx.shadowOffsetY = 1.2 * px;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = ROUNDED_RIM;
  ctx.stroke(p);
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.fill(p);
  // Stroking in the fill colour rounds the coloured corners too.
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.fill(p);
  ctx.stroke(p);
  ctx.restore();
}

function drawRoundedTag(ctx: CanvasRenderingContext2D, color: string, label: string) {
  if (!label) {
    return;
  }
  const { x, y, height, radius, padding } = ROUNDED_TAG;
  ctx.save();
  ctx.font = ROUNDED_TAG_FONT;
  const width = ctx.measureText(label).width + padding * 2;
  const px = currentScale(ctx);
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 5 * px;
  ctx.shadowOffsetY = 1.5 * px;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padding, y + height / 2 + 1);
  ctx.restore();
}

function drawTextBar(ctx: CanvasRenderingContext2D, color: string) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-2.2, -14, 4.4, 28, 2.2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

function drawWindowsIBeam(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.scale(1.9, 1.9);
  ctx.translate(-12, -12);
  ctx.lineCap = 'round';
  const p = path(WINDOWS_I_BEAM);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.4;
  ctx.stroke(p);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.4;
  ctx.stroke(p);
  ctx.restore();
}

function drawTouch(ctx: CanvasRenderingContext2D, pressed: boolean) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, pressed ? 13 : 17, 0, Math.PI * 2);
  ctx.fillStyle = pressed ? 'rgba(110,110,115,0.65)' : 'rgba(110,110,115,0.45)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws a vector cursor style with its hotspot at the current origin, in draw
 * units (the caller scales the context to the on-screen cursor size).
 */
export function drawCursorStyle(
  ctx: CanvasRenderingContext2D,
  style: VectorCursorStyleId,
  state: CursorDrawState,
  options: Partial<CursorDrawOptions> = {},
): void {
  const { time, color, label, pressed } = { ...DEFAULT_CURSOR_DRAW_OPTIONS, ...options };
  switch (style) {
    case 'macos-white':
      if (state === 'pointer') {
        drawShape(ctx, HAND_SHAPE, WHITE_HAND, time);
      } else if (state === 'text') {
        drawShape(ctx, I_BEAM_SHAPE, WHITE, time);
      } else {
        drawShape(ctx, MAC_ARROW_SHAPE, WHITE, time);
      }
      return;
    case 'windows':
      if (state === 'pointer') {
        drawShape(ctx, HAND_SHAPE, MAC_HAND, time);
      } else if (state === 'text') {
        drawWindowsIBeam(ctx);
      } else {
        drawShape(ctx, ARROW_SHAPE, { kind: 'solid', fill: '#ffffff', outline: '#000000' }, time);
      }
      return;
    case 'touch':
      drawTouch(ctx, pressed);
      return;
    case 'wedge':
    case 'collaborator': {
      const fill = style === 'wedge' ? '#111114' : color;
      if (state === 'text') {
        drawTextBar(ctx, fill);
      } else {
        ctx.save();
        ctx.rotate(WEDGE_TURN);
        drawShape(ctx, WEDGE_SHAPE, { kind: 'solid', fill, outline: '#ffffff' }, time);
        ctx.restore();
      }
      if (style === 'collaborator') {
        drawNameTag(ctx, color, label);
      }
      return;
    }
    case 'rounded':
      if (state === 'text') {
        drawTextBar(ctx, color);
      } else {
        ctx.save();
        ctx.rotate(ROUNDED_TURN);
        drawRoundedPointer(ctx, color);
        ctx.restore();
      }
      drawRoundedTag(ctx, color, label);
      return;
    case 'gradient':
    case 'glitter':
    case 'glass': {
      const [shape, finish] = finishedShape(style, state);
      drawShape(ctx, shape, finish, time);
      return;
    }
    case 'sparkle':
      if (state === 'pointer') {
        drawShape(ctx, HAND_SHAPE, MAC_HAND, time);
      } else if (state === 'text') {
        drawShape(ctx, I_BEAM_SHAPE, MAC_TEXT, time);
      } else {
        drawShape(ctx, MAC_ARROW_SHAPE, MAC, time);
      }
      drawSparkleAccent(ctx, state, time);
      return;
  }
}

// ── Extents ──────────────────────────────────────────────────────────────────

export interface CursorExtent {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function shapeExtent(shape: Shape, margin: number): CursorExtent {
  const pad = (shape.stroke * shape.s) / 2 + margin;
  return {
    left: shape.tx + shape.box[0] * shape.s - pad,
    top: shape.ty + shape.box[1] * shape.s - pad,
    right: shape.tx + shape.box[2] * shape.s + pad,
    bottom: shape.ty + shape.box[3] * shape.s + pad,
  };
}

/** The box that holds `e` once it is turned by `angle` about the hotspot. */
function rotateExtent(e: CursorExtent, angle: number): CursorExtent {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners: Vec[] = [
    [e.left, e.top],
    [e.right, e.top],
    [e.left, e.bottom],
    [e.right, e.bottom],
  ].map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
  return {
    left: Math.min(...corners.map((c) => c[0])),
    top: Math.min(...corners.map((c) => c[1])),
    right: Math.max(...corners.map((c) => c[0])),
    bottom: Math.max(...corners.map((c) => c[1])),
  };
}

function union(a: CursorExtent, b: CursorExtent): CursorExtent {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

/**
 * The area a style can paint, in draw units around its hotspot: textures are
 * sized from it. `measure` gives the name tag's real text width when a canvas
 * is at hand; without one the width is estimated generously.
 */
export function getCursorStyleExtent(
  style: CursorStyleId,
  state: CursorDrawState,
  label: string = DEFAULT_CURSOR_LABEL,
  measure?: (text: string, font: string) => number,
): CursorExtent {
  const margin = 3;
  const shapeFor = (s: CursorDrawState) =>
    s === 'pointer' ? HAND_SHAPE : s === 'text' ? I_BEAM_SHAPE : MAC_ARROW_SHAPE;
  switch (style) {
    case 'cursor01':
    case 'macos-white':
      return shapeExtent(shapeFor(state), margin);
    case 'windows':
      return state === 'text'
        ? { left: -12, top: -21, right: 12, bottom: 21 }
        : shapeExtent(state === 'pointer' ? HAND_SHAPE : ARROW_SHAPE, margin);
    case 'touch':
      return { left: -20, top: -20, right: 20, bottom: 20 };
    case 'wedge':
    case 'collaborator': {
      const base =
        state === 'text'
          ? { left: -5, top: -16, right: 5, bottom: 16 }
          : rotateExtent(shapeExtent(WEDGE_SHAPE, margin), WEDGE_TURN);
      if (style === 'wedge' || !label) {
        return base;
      }
      const textWidth = measure ? measure(label, TAG_FONT) : label.length * TAG_FONT_SIZE * 0.68;
      return union(base, {
        left: TAG_X - 2,
        top: TAG_Y - 2,
        right: TAG_X + textWidth + TAG_PADDING_X * 2 + 3,
        bottom: TAG_Y + TAG_HEIGHT + 3,
      });
    }
    case 'rounded': {
      // Pointer box plus its rim and shadow.
      const base =
        state === 'text'
          ? { left: -5, top: -16, right: 5, bottom: 16 }
          : rotateExtent(
              {
                left: -8,
                top: -8,
                right: 21.5 * ROUNDED_SCALE + 9,
                bottom: 21.8 * ROUNDED_SCALE + 11,
              },
              ROUNDED_TURN,
            );
      if (!label) {
        return base;
      }
      const textWidth = measure
        ? measure(label, ROUNDED_TAG_FONT)
        : label.length * ROUNDED_TAG.fontSize * 0.68;
      return union(base, {
        left: ROUNDED_TAG.x - 6,
        top: ROUNDED_TAG.y - 6,
        right: ROUNDED_TAG.x + textWidth + ROUNDED_TAG.padding * 2 + 6,
        bottom: ROUNDED_TAG.y + ROUNDED_TAG.height + 9,
      });
    }
    case 'gradient':
    case 'glitter':
    case 'glass': {
      const [shape] = finishedShape(style, state);
      const extent = shapeExtent(shape, margin);
      // Room for the glass's drop shadow.
      return style === 'glass'
        ? { ...extent, right: extent.right + 8, bottom: extent.bottom + 12 }
        : extent;
    }
    case 'sparkle': {
      const anchor = SPARKLE_ANCHOR[state];
      return union(shapeExtent(shapeFor(state), margin), {
        left: anchor.x - 11,
        top: anchor.y - 11,
        right: anchor.x + 10 + 6,
        bottom: anchor.y + 12 + 6,
      });
    }
  }
}

/**
 * Paints a style into a canvas at `resolution` pixels per draw unit, sized to its
 * extent. Returns where the hotspot sits as a fraction of the canvas (a sprite anchor).
 */
export function renderCursorStyleToCanvas(
  canvas: HTMLCanvasElement,
  style: VectorCursorStyleId,
  state: CursorDrawState,
  options: Partial<CursorDrawOptions>,
  resolution: number,
): { anchorX: number; anchorY: number; widthUnits: number } {
  const ctx = canvas.getContext('2d');
  const label = options.label ?? DEFAULT_CURSOR_LABEL;
  const measure = ctx
    ? (text: string, font: string) => {
        ctx.font = font;
        return ctx.measureText(text).width;
      }
    : undefined;
  const extent = getCursorStyleExtent(style, state, label, measure);
  const widthUnits = extent.right - extent.left;
  const heightUnits = extent.bottom - extent.top;
  const width = Math.max(1, Math.ceil(widthUnits * resolution));
  const height = Math.max(1, Math.ceil(heightUnits * resolution));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.setTransform(
      resolution,
      0,
      0,
      resolution,
      -extent.left * resolution,
      -extent.top * resolution,
    );
    drawCursorStyle(ctx, style, state, options);
  }
  return {
    anchorX: -extent.left / (width / resolution),
    anchorY: -extent.top / (height / resolution),
    widthUnits: width / resolution,
  };
}
