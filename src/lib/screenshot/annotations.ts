/**
 * Screenshot annotation shapes — pure data + geometry.
 *
 * Every shape lives in the screenshot's own pixel space (0..imageWidth,
 * 0..imageHeight), so annotations stay put when the frame, padding or aspect
 * ratio around the image changes. Shapes are plain serializable objects; the
 * canvas drawing lives in `compose.ts`.
 */

export type AnnotationTool = 'select' | 'arrow' | 'box' | 'highlight' | 'blur' | 'text' | 'step';
export type AnnotationShapeType = Exclude<AnnotationTool, 'select'>;
export type DragShapeType = 'arrow' | 'box' | 'highlight' | 'blur';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BaseShape {
  id: string;
  color: string;
}

export interface ArrowShape extends BaseShape {
  type: 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth: number;
}

export interface BoxShape extends BaseShape, Rect {
  type: 'box';
  strokeWidth: number;
}

export interface HighlightShape extends BaseShape, Rect {
  type: 'highlight';
}

export interface BlurShape extends BaseShape, Rect {
  type: 'blur';
}

export interface TextShape extends BaseShape {
  type: 'text';
  /** Top-left corner of the first line. */
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export interface StepShape extends BaseShape {
  type: 'step';
  /** Centre of the numbered badge. */
  x: number;
  y: number;
  radius: number;
}

export type AnnotationShape =
  | ArrowShape
  | BoxShape
  | HighlightShape
  | BlurShape
  | TextShape
  | StepShape;

export interface ShapeStyle {
  color: string;
  /** Size multiplier from `getAnnotationScale` — keeps strokes legible on hi-dpi captures. */
  scale: number;
}

export const ANNOTATION_COLORS = [
  '#ef4444',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#3b82f6',
  '#ffffff',
  '#111111',
] as const;

const BASE_STROKE_WIDTH = 4;
const BASE_FONT_SIZE = 28;
const BASE_STEP_RADIUS = 18;
const MIN_DRAG_SIZE = 4;
const TEXT_CHAR_WIDTH = 0.6;
export const TEXT_LINE_HEIGHT = 1.25;
export const HIGHLIGHT_ALPHA = 0.35;

/** Size unit for new annotations: 1 at ~1080p, 2 at 4K. */
export function getAnnotationScale(imageWidth: number, imageHeight: number): number {
  return Math.max(0.5, Math.min(imageWidth, imageHeight) / 1080);
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function strokeFor(style: ShapeStyle): number {
  return Math.max(1, Math.round(BASE_STROKE_WIDTH * style.scale));
}

export function createShapeFromDrag(
  type: DragShapeType,
  start: Point,
  end: Point,
  id: string,
  style: ShapeStyle,
): AnnotationShape | null {
  if (type === 'arrow') {
    if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_DRAG_SIZE) {
      return null;
    }
    return {
      id,
      type,
      color: style.color,
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      strokeWidth: strokeFor(style),
    };
  }

  const rect = normalizeRect(start, end);
  if (rect.width < MIN_DRAG_SIZE || rect.height < MIN_DRAG_SIZE) {
    return null;
  }
  if (type === 'box') {
    return { id, type, color: style.color, ...rect, strokeWidth: strokeFor(style) };
  }
  return { id, type, color: style.color, ...rect };
}

export function createTextShape(
  point: Point,
  text: string,
  id: string,
  style: ShapeStyle,
): TextShape | null {
  if (!text.trim()) {
    return null;
  }
  return {
    id,
    type: 'text',
    color: style.color,
    x: point.x,
    y: point.y,
    text,
    fontSize: getDefaultFontSize(style.scale),
  };
}

export function createStepShape(point: Point, id: string, style: ShapeStyle): StepShape {
  return {
    id,
    type: 'step',
    color: style.color,
    x: point.x,
    y: point.y,
    radius: Math.max(6, Math.round(BASE_STEP_RADIUS * style.scale)),
  };
}

/** Step badges are numbered by their position in the list, so deleting one renumbers the rest. */
export function getStepNumbers(shapes: readonly AnnotationShape[]): Map<string, number> {
  const numbers = new Map<string, number>();
  let n = 0;
  for (const shape of shapes) {
    if (shape.type === 'step') {
      n += 1;
      numbers.set(shape.id, n);
    }
  }
  return numbers;
}

export interface ArrowHead {
  tip: Point;
  left: Point;
  right: Point;
}

const ARROW_HEAD_ANGLE = (28 * Math.PI) / 180;

export function getArrowHead(shape: ArrowShape): ArrowHead {
  const dx = shape.x2 - shape.x1;
  const dy = shape.y2 - shape.y1;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  const headLength = Math.min(length, Math.max(12, shape.strokeWidth * 4));
  // Wing length so the head's depth along the shaft equals headLength.
  const wing = headLength / Math.cos(ARROW_HEAD_ANGLE);
  const back = angle + Math.PI;
  return {
    tip: { x: shape.x2, y: shape.y2 },
    left: {
      x: shape.x2 + Math.cos(back - ARROW_HEAD_ANGLE) * wing,
      y: shape.y2 + Math.sin(back - ARROW_HEAD_ANGLE) * wing,
    },
    right: {
      x: shape.x2 + Math.cos(back + ARROW_HEAD_ANGLE) * wing,
      y: shape.y2 + Math.sin(back + ARROW_HEAD_ANGLE) * wing,
    },
  };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function getTextLines(text: string): string[] {
  return text.split('\n');
}

export function getShapeBounds(shape: AnnotationShape): Rect {
  switch (shape.type) {
    case 'arrow':
      return normalizeRect({ x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 });
    case 'step':
      return {
        x: shape.x - shape.radius,
        y: shape.y - shape.radius,
        width: shape.radius * 2,
        height: shape.radius * 2,
      };
    case 'text': {
      const lines = getTextLines(shape.text);
      const longest = Math.max(...lines.map((line) => line.length));
      return {
        x: shape.x,
        y: shape.y,
        width: longest * shape.fontSize * TEXT_CHAR_WIDTH,
        height: lines.length * shape.fontSize * TEXT_LINE_HEIGHT,
      };
    }
    default:
      return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
}

function insideRect(p: Point, rect: Rect, tolerance: number): boolean {
  return (
    p.x >= rect.x - tolerance &&
    p.x <= rect.x + rect.width + tolerance &&
    p.y >= rect.y - tolerance &&
    p.y <= rect.y + rect.height + tolerance
  );
}

export function hitTestShape(shape: AnnotationShape, p: Point, tolerance: number): boolean {
  switch (shape.type) {
    case 'arrow':
      return (
        distanceToSegment(p, { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y2 }) <=
        tolerance + shape.strokeWidth / 2
      );
    case 'step':
      return Math.hypot(p.x - shape.x, p.y - shape.y) <= shape.radius + tolerance;
    case 'box':
      return insideRect(p, shape, tolerance + shape.strokeWidth / 2);
    default:
      return insideRect(p, getShapeBounds(shape), tolerance);
  }
}

/**
 * Compositing order, bottom to top. Blur rewrites image pixels so it must run
 * first; the translucent highlight sits under strokes; badges and text stay
 * readable on top of everything.
 */
const LAYER: Record<AnnotationShapeType, number> = {
  blur: 0,
  highlight: 1,
  box: 2,
  arrow: 3,
  step: 4,
  text: 5,
};

export function getRenderOrder(shapes: readonly AnnotationShape[]): AnnotationShape[] {
  return shapes
    .map((shape, index) => ({ shape, index }))
    .sort((a, b) => LAYER[a.shape.type] - LAYER[b.shape.type] || a.index - b.index)
    .map(({ shape }) => shape);
}

/** Topmost shape under the point (reverse render order), or null. */
export function findShapeAt(
  shapes: readonly AnnotationShape[],
  p: Point,
  tolerance: number,
): string | null {
  const ordered = getRenderOrder(shapes);
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (hitTestShape(ordered[i], p, tolerance)) {
      return ordered[i].id;
    }
  }
  return null;
}

export function translateShape<T extends AnnotationShape>(shape: T, dx: number, dy: number): T {
  if (shape.type === 'arrow') {
    return {
      ...shape,
      x1: shape.x1 + dx,
      y1: shape.y1 + dy,
      x2: shape.x2 + dx,
      y2: shape.y2 + dy,
    };
  }
  return { ...shape, x: shape.x + dx, y: shape.y + dy };
}

export interface BlurRegion {
  /** Image-pixel rect that ends up blurred (clamped to the image). */
  rect: Rect;
  /** Larger rect sampled from the image so edges blur with real neighbouring pixels. */
  sample: Rect;
  /** Blur radius in image pixels. */
  radius: number;
}

export function getBlurRegion(
  shape: BlurShape,
  imageWidth: number,
  imageHeight: number,
): BlurRegion | null {
  const left = Math.max(0, Math.floor(shape.x));
  const top = Math.max(0, Math.floor(shape.y));
  const right = Math.min(imageWidth, Math.ceil(shape.x + shape.width));
  const bottom = Math.min(imageHeight, Math.ceil(shape.y + shape.height));
  if (right <= left || bottom <= top) {
    return null;
  }
  const rect = { x: left, y: top, width: right - left, height: bottom - top };
  // Strong enough that small text is unreadable, but bounded so large regions stay cheap.
  const radius = Math.max(8, Math.min(40, Math.round(Math.min(rect.width, rect.height) / 3)));
  const margin = radius * 2;
  const sx = Math.max(0, rect.x - margin);
  const sy = Math.max(0, rect.y - margin);
  const sample = {
    x: sx,
    y: sy,
    width: Math.min(imageWidth, rect.x + rect.width + margin) - sx,
    height: Math.min(imageHeight, rect.y + rect.height + margin) - sy,
  };
  return { rect, sample, radius };
}

/** Default font size for new text at a given annotation scale. */
export function getDefaultFontSize(scale: number): number {
  return Math.max(8, Math.round(BASE_FONT_SIZE * scale));
}

/** A text box being typed into (new when `editingId` is null). */
export interface TextEdit {
  point: Point;
  value: string;
  editingId: string | null;
}

// ── Editing state (undoable) ─────────────────────────────────────────────────

export const ANNOTATION_HISTORY_LIMIT = 100;

export interface AnnotationsState {
  shapes: AnnotationShape[];
  past: AnnotationShape[][];
  future: AnnotationShape[][];
}

export type AnnotationsAction =
  | { type: 'add'; shape: AnnotationShape }
  | { type: 'update'; shape: AnnotationShape }
  | { type: 'remove'; id: string }
  | { type: 'undo' }
  | { type: 'redo' };

export function createInitialAnnotationsState(): AnnotationsState {
  return { shapes: [], past: [], future: [] };
}

function commit(state: AnnotationsState, shapes: AnnotationShape[]): AnnotationsState {
  return {
    shapes,
    past: [...state.past, state.shapes].slice(-ANNOTATION_HISTORY_LIMIT),
    future: [],
  };
}

export function annotationsReducer(
  state: AnnotationsState,
  action: AnnotationsAction,
): AnnotationsState {
  switch (action.type) {
    case 'add':
      return commit(state, [...state.shapes, action.shape]);
    case 'update': {
      const index = state.shapes.findIndex((s) => s.id === action.shape.id);
      if (index === -1) {
        return state;
      }
      const shapes = [...state.shapes];
      shapes[index] = action.shape;
      return commit(state, shapes);
    }
    case 'remove': {
      if (!state.shapes.some((s) => s.id === action.id)) {
        return state;
      }
      return commit(
        state,
        state.shapes.filter((s) => s.id !== action.id),
      );
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous) {
        return state;
      }
      return {
        shapes: previous,
        past: state.past.slice(0, -1),
        future: [state.shapes, ...state.future],
      };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) {
        return state;
      }
      return { shapes: next, past: [...state.past, state.shapes], future: rest };
    }
  }
}

/** Turns a finished text box into the edit it implies (add / update / remove), or null. */
export function resolveTextEdit(
  shapes: readonly AnnotationShape[],
  edit: TextEdit,
  newId: string,
  style: ShapeStyle,
): AnnotationsAction | null {
  if (edit.editingId === null) {
    const shape = createTextShape(edit.point, edit.value, newId, style);
    return shape ? { type: 'add', shape } : null;
  }
  const existing = shapes.find((s) => s.id === edit.editingId);
  if (!existing || existing.type !== 'text') {
    return null;
  }
  if (!edit.value.trim()) {
    return { type: 'remove', id: existing.id };
  }
  if (edit.value === existing.text) {
    return null;
  }
  return { type: 'update', shape: { ...existing, text: edit.value } };
}
