import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_HISTORY_LIMIT,
  annotationsReducer,
  createInitialAnnotationsState,
  createShapeFromDrag,
  createStepShape,
  createTextShape,
  distanceToSegment,
  findGrabbableShapeAt,
  findShapeAt,
  getAnnotationScale,
  getArrowHead,
  getBlurRegion,
  getRenderOrder,
  getShapeBounds,
  getStepNumbers,
  hitTestShape,
  normalizeRect,
  resolveTextEdit,
  translateShape,
  type AnnotationShape,
  type ArrowShape,
  type BoxShape,
} from './annotations';

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error('expected a value');
  }
  return value;
};

const style = { color: '#ff0000', scale: 1 };

const box = (id: string, x = 10, y = 10, width = 100, height = 50): BoxShape => ({
  id,
  type: 'box',
  color: '#ff0000',
  x,
  y,
  width,
  height,
  strokeWidth: 4,
});

const arrow = (id: string): ArrowShape => ({
  id,
  type: 'arrow',
  color: '#ff0000',
  x1: 0,
  y1: 0,
  x2: 100,
  y2: 0,
  strokeWidth: 4,
});

describe('normalizeRect', () => {
  it('orders corners so width and height are positive', () => {
    expect(normalizeRect({ x: 50, y: 40 }, { x: 10, y: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 20,
    });
  });
});

describe('getAnnotationScale', () => {
  it('is 1 for a 1080p-ish image and grows with resolution', () => {
    expect(getAnnotationScale(1920, 1080)).toBe(1);
    expect(getAnnotationScale(3840, 2160)).toBe(2);
  });

  it('never goes below a floor for tiny images', () => {
    expect(getAnnotationScale(100, 50)).toBeGreaterThanOrEqual(0.5);
  });
});

describe('createShapeFromDrag', () => {
  it('builds a box from any drag direction', () => {
    const shape = createShapeFromDrag('box', { x: 120, y: 80 }, { x: 20, y: 30 }, 'b1', style);
    expect(shape).toMatchObject({ id: 'b1', type: 'box', x: 20, y: 30, width: 100, height: 50 });
  });

  it('keeps arrow direction (tail at start, head at end)', () => {
    const shape = createShapeFromDrag('arrow', { x: 5, y: 6 }, { x: 105, y: 56 }, 'a1', style);
    expect(shape).toMatchObject({ type: 'arrow', x1: 5, y1: 6, x2: 105, y2: 56 });
  });

  it('builds highlight and blur rectangles', () => {
    expect(
      createShapeFromDrag('highlight', { x: 0, y: 0 }, { x: 40, y: 20 }, 'h', style),
    ).toMatchObject({ type: 'highlight', width: 40, height: 20 });
    expect(
      createShapeFromDrag('blur', { x: 0, y: 0 }, { x: 40, y: 20 }, 'bl', style),
    ).toMatchObject({ type: 'blur', width: 40, height: 20 });
  });

  it('returns null for drags that are too small to be intentional', () => {
    expect(createShapeFromDrag('box', { x: 0, y: 0 }, { x: 2, y: 2 }, 'x', style)).toBeNull();
    expect(createShapeFromDrag('arrow', { x: 0, y: 0 }, { x: 1, y: 1 }, 'x', style)).toBeNull();
  });

  it('scales stroke width with the annotation scale', () => {
    const small = createShapeFromDrag('box', { x: 0, y: 0 }, { x: 50, y: 50 }, 'a', style);
    const big = createShapeFromDrag('box', { x: 0, y: 0 }, { x: 50, y: 50 }, 'b', {
      ...style,
      scale: 2,
    });
    expect((big as BoxShape).strokeWidth).toBe((small as BoxShape).strokeWidth * 2);
  });
});

describe('createTextShape / createStepShape', () => {
  it('ignores empty text', () => {
    expect(createTextShape({ x: 0, y: 0 }, '   ', 't', style)).toBeNull();
  });

  it('creates text anchored at its top-left point', () => {
    expect(createTextShape({ x: 12, y: 34 }, 'Hello', 't', style)).toMatchObject({
      type: 'text',
      x: 12,
      y: 34,
      text: 'Hello',
    });
  });

  it('creates a step centred on the click point', () => {
    expect(createStepShape({ x: 50, y: 60 }, 's', style)).toMatchObject({
      type: 'step',
      x: 50,
      y: 60,
    });
  });
});

describe('getStepNumbers', () => {
  it('numbers steps by their order in the list, skipping other shapes', () => {
    const shapes: AnnotationShape[] = [
      createStepShape({ x: 0, y: 0 }, 's1', style),
      box('b1'),
      createStepShape({ x: 0, y: 0 }, 's2', style),
      createStepShape({ x: 0, y: 0 }, 's3', style),
    ];
    const numbers = getStepNumbers(shapes);
    expect(numbers.get('s1')).toBe(1);
    expect(numbers.get('s2')).toBe(2);
    expect(numbers.get('s3')).toBe(3);
    expect(numbers.has('b1')).toBe(false);
  });

  it('renumbers after a step is removed', () => {
    const shapes: AnnotationShape[] = [
      createStepShape({ x: 0, y: 0 }, 's1', style),
      createStepShape({ x: 0, y: 0 }, 's3', style),
    ];
    expect(getStepNumbers(shapes).get('s3')).toBe(2);
  });
});

describe('getArrowHead', () => {
  it('places the tip at the arrow end and wings behind it', () => {
    const head = getArrowHead(arrow('a'));
    expect(head.tip).toEqual({ x: 100, y: 0 });
    expect(head.left.x).toBeLessThan(100);
    expect(head.right.x).toBeLessThan(100);
    // Symmetric around the shaft
    expect(head.left.y).toBeCloseTo(-head.right.y);
  });

  it('grows with stroke width', () => {
    const thin = getArrowHead(arrow('a'));
    const thick = getArrowHead({ ...arrow('b'), strokeWidth: 12 });
    expect(100 - thick.left.x).toBeGreaterThan(100 - thin.left.x);
  });

  it('never makes the head longer than the arrow itself', () => {
    const tiny: ArrowShape = { ...arrow('a'), x2: 10, strokeWidth: 20 };
    const head = getArrowHead(tiny);
    expect(10 - head.left.x).toBeLessThanOrEqual(10);
  });
});

describe('distanceToSegment', () => {
  it('measures perpendicular distance inside the segment', () => {
    expect(distanceToSegment({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10);
  });

  it('measures to the nearest endpoint outside the segment', () => {
    expect(distanceToSegment({ x: 103, y: 4 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(5);
  });

  it('handles zero-length segments', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe('getShapeBounds', () => {
  it('covers both arrow endpoints', () => {
    expect(getShapeBounds({ ...arrow('a'), x1: 50, y1: 80, x2: 10, y2: 20 })).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it('sizes text by its longest line and line count', () => {
    const one = getShapeBounds(must(createTextShape({ x: 0, y: 0 }, 'abcd', 't', style)));
    const two = getShapeBounds(must(createTextShape({ x: 0, y: 0 }, 'abcd\nabcdefgh', 't', style)));
    expect(two.width).toBeCloseTo(one.width * 2);
    expect(two.height).toBeCloseTo(one.height * 2);
  });

  it('centres step bounds on the step point', () => {
    const step = createStepShape({ x: 100, y: 100 }, 's', style);
    const bounds = getShapeBounds(step);
    expect(bounds.x + bounds.width / 2).toBe(100);
    expect(bounds.y + bounds.height / 2).toBe(100);
  });
});

describe('hitTestShape', () => {
  it('hits an arrow near its shaft but not far away', () => {
    expect(hitTestShape(arrow('a'), { x: 50, y: 3 }, 4)).toBe(true);
    expect(hitTestShape(arrow('a'), { x: 50, y: 30 }, 4)).toBe(false);
  });

  it('hits a box inside or on its edge', () => {
    expect(hitTestShape(box('b'), { x: 50, y: 30 }, 4)).toBe(true);
    expect(hitTestShape(box('b'), { x: 8, y: 30 }, 4)).toBe(true);
    expect(hitTestShape(box('b'), { x: 200, y: 200 }, 4)).toBe(false);
  });

  it('hits a step within its circle', () => {
    const step = createStepShape({ x: 100, y: 100 }, 's', style);
    expect(hitTestShape(step, { x: 100 + step.radius - 1, y: 100 }, 0)).toBe(true);
    expect(hitTestShape(step, { x: 100 + step.radius * 2, y: 100 }, 0)).toBe(false);
  });
});

describe('findShapeAt', () => {
  it('returns the topmost shape in render order', () => {
    const blur = must(
      createShapeFromDrag('blur', { x: 0, y: 0 }, { x: 200, y: 200 }, 'blur', style),
    );
    const b = box('box', 0, 0, 200, 200);
    // blur is listed last but renders first (underneath), so the box wins.
    expect(findShapeAt([b, blur], { x: 50, y: 50 }, 4)).toBe('box');
  });

  it('prefers the later shape among equal layers', () => {
    expect(findShapeAt([box('a'), box('b')], { x: 50, y: 30 }, 4)).toBe('b');
  });

  it('returns null when nothing is hit', () => {
    expect(findShapeAt([box('a')], { x: 500, y: 500 }, 4)).toBeNull();
  });
});

describe('findGrabbableShapeAt', () => {
  it('grabs any shape anywhere with the Select tool', () => {
    expect(findGrabbableShapeAt([box('b')], { x: 50, y: 30 }, 4, 'select')).toBe('b');
  });

  it('grabs a box by its edge with a drawing tool, so a new box can start inside it', () => {
    expect(findGrabbableShapeAt([box('b')], { x: 11, y: 30 }, 4, 'box')).toBe('b');
    expect(findGrabbableShapeAt([box('b')], { x: 50, y: 30 }, 4, 'box')).toBeNull();
  });

  it('grabs highlight and blur regions by their edge with a drawing tool', () => {
    const blur: AnnotationShape = {
      id: 'z',
      type: 'blur',
      color: '#000',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    };
    expect(findGrabbableShapeAt([blur], { x: 50, y: 50 }, 4, 'step')).toBeNull();
    expect(findGrabbableShapeAt([blur], { x: 99, y: 50 }, 4, 'step')).toBe('z');
  });

  it('grabs arrows, steps and text anywhere on them with any tool', () => {
    expect(findGrabbableShapeAt([arrow('a')], { x: 50, y: 3 }, 4, 'box')).toBe('a');
    const step = createStepShape({ x: 100, y: 100 }, 's', style);
    expect(findGrabbableShapeAt([step], { x: 100, y: 100 }, 0, 'arrow')).toBe('s');
    const text = must(createTextShape({ x: 0, y: 0 }, 'Hello', 't', style));
    expect(findGrabbableShapeAt([text], { x: 10, y: 10 }, 0, 'text')).toBe('t');
  });
});

describe('translateShape', () => {
  it('moves both arrow endpoints', () => {
    expect(translateShape(arrow('a'), 5, -5)).toMatchObject({ x1: 5, y1: -5, x2: 105, y2: -5 });
  });

  it('moves rect-like shapes by their origin', () => {
    expect(translateShape(box('b'), 1, 2)).toMatchObject({ x: 11, y: 12, width: 100 });
  });
});

describe('getRenderOrder', () => {
  it('draws blur first, then highlight, boxes, arrows, steps, text', () => {
    const shapes: AnnotationShape[] = [
      must(createTextShape({ x: 0, y: 0 }, 'hi', 'text', style)),
      createStepShape({ x: 0, y: 0 }, 'step', style),
      arrow('arrow'),
      box('box'),
      must(createShapeFromDrag('highlight', { x: 0, y: 0 }, { x: 10, y: 10 }, 'hl', style)),
      must(createShapeFromDrag('blur', { x: 0, y: 0 }, { x: 10, y: 10 }, 'blur', style)),
    ];
    expect(getRenderOrder(shapes).map((s) => s.id)).toEqual([
      'blur',
      'hl',
      'box',
      'arrow',
      'step',
      'text',
    ]);
  });

  it('keeps creation order within a layer', () => {
    expect(getRenderOrder([box('a'), box('b'), box('c')]).map((s) => s.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('getBlurRegion', () => {
  const blurShape = (x: number, y: number, width: number, height: number) => ({
    id: 'b',
    type: 'blur' as const,
    color: '#000',
    x,
    y,
    width,
    height,
  });

  it('clamps the blurred rect to the image', () => {
    const region = getBlurRegion(blurShape(-20, -20, 100, 100), 50, 50);
    expect(region?.rect).toEqual({ x: 0, y: 0, width: 50, height: 50 });
  });

  it('returns null when the region falls outside the image', () => {
    expect(getBlurRegion(blurShape(100, 100, 20, 20), 50, 50)).toBeNull();
  });

  it('samples a margin around the rect so edges blur with real pixels', () => {
    const region = must(getBlurRegion(blurShape(200, 200, 100, 100), 1000, 1000));
    expect(region.sample.x).toBe(200 - region.radius * 2);
    expect(region.sample.width).toBe(100 + region.radius * 4);
  });

  it('keeps the sample inside the image', () => {
    const region = must(getBlurRegion(blurShape(0, 0, 100, 100), 120, 120));
    expect(region.sample.x).toBe(0);
    expect(region.sample.x + region.sample.width).toBeLessThanOrEqual(120);
  });

  it('uses a strong radius for small regions so text is unreadable', () => {
    expect(must(getBlurRegion(blurShape(0, 0, 20, 10), 100, 100)).radius).toBeGreaterThanOrEqual(8);
  });
});

describe('annotationsReducer', () => {
  it('adds, updates and removes shapes', () => {
    let state = createInitialAnnotationsState();
    state = annotationsReducer(state, { type: 'add', shape: box('a') });
    state = annotationsReducer(state, { type: 'update', shape: { ...box('a'), x: 99 } });
    expect(state.shapes[0]).toMatchObject({ x: 99 });
    state = annotationsReducer(state, { type: 'remove', id: 'a' });
    expect(state.shapes).toEqual([]);
  });

  it('undoes and redoes edits', () => {
    let state = createInitialAnnotationsState();
    state = annotationsReducer(state, { type: 'add', shape: box('a') });
    state = annotationsReducer(state, { type: 'add', shape: box('b') });
    state = annotationsReducer(state, { type: 'undo' });
    expect(state.shapes.map((s) => s.id)).toEqual(['a']);
    state = annotationsReducer(state, { type: 'redo' });
    expect(state.shapes.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('clears the redo stack on a new edit', () => {
    let state = createInitialAnnotationsState();
    state = annotationsReducer(state, { type: 'add', shape: box('a') });
    state = annotationsReducer(state, { type: 'undo' });
    state = annotationsReducer(state, { type: 'add', shape: box('b') });
    expect(state.future).toEqual([]);
  });

  it('ignores undo/redo with empty stacks and no-op updates', () => {
    const state = createInitialAnnotationsState();
    expect(annotationsReducer(state, { type: 'undo' })).toBe(state);
    expect(annotationsReducer(state, { type: 'redo' })).toBe(state);
    expect(annotationsReducer(state, { type: 'remove', id: 'missing' })).toBe(state);
    expect(annotationsReducer(state, { type: 'update', shape: box('missing') })).toBe(state);
  });

  it('undoes and redoes style changes with the shapes', () => {
    let state = createInitialAnnotationsState({ padding: 1 });
    state = annotationsReducer(state, { type: 'add', shape: box('a') });
    state = annotationsReducer(state, { type: 'setStyle', style: { padding: 2 } });
    state = annotationsReducer(state, { type: 'undo' });
    expect(state.style).toEqual({ padding: 1 });
    expect(state.shapes.map((s) => s.id)).toEqual(['a']);
    state = annotationsReducer(state, { type: 'undo' });
    expect(state.shapes).toEqual([]);
    state = annotationsReducer(state, { type: 'redo' });
    state = annotationsReducer(state, { type: 'redo' });
    expect(state.style).toEqual({ padding: 2 });
  });

  it('folds a slider drag into one undo step', () => {
    let state = createInitialAnnotationsState({ padding: 0 });
    for (const padding of [1, 2, 3]) {
      state = annotationsReducer(state, { type: 'setStyle', style: { padding }, group: 'drag-1' });
    }
    expect(state.past).toHaveLength(1);
    state = annotationsReducer(state, { type: 'setStyle', style: { padding: 9 }, group: 'drag-2' });
    expect(state.past).toHaveLength(2);
    state = annotationsReducer(state, { type: 'undo' });
    expect(state.style).toEqual({ padding: 3 });
    state = annotationsReducer(state, { type: 'undo' });
    expect(state.style).toEqual({ padding: 0 });
  });

  it('starts a new undo step after an undo, even within the same group', () => {
    let state = createInitialAnnotationsState({ padding: 0 });
    state = annotationsReducer(state, { type: 'setStyle', style: { padding: 1 }, group: 'g' });
    state = annotationsReducer(state, { type: 'undo' });
    state = annotationsReducer(state, { type: 'setStyle', style: { padding: 5 }, group: 'g' });
    expect(state.past).toHaveLength(1);
    expect(state.past[0].style).toEqual({ padding: 0 });
  });

  it('caps history', () => {
    let state = createInitialAnnotationsState();
    for (let i = 0; i < ANNOTATION_HISTORY_LIMIT + 10; i++) {
      state = annotationsReducer(state, { type: 'add', shape: box(`s${i}`) });
    }
    expect(state.past.length).toBe(ANNOTATION_HISTORY_LIMIT);
  });
});

describe('resolveTextEdit', () => {
  it('adds a new text shape', () => {
    const action = resolveTextEdit(
      [],
      { point: { x: 1, y: 2 }, value: 'Hi', editingId: null },
      'new',
      style,
    );
    expect(action).toMatchObject({ type: 'add', shape: { id: 'new', text: 'Hi', x: 1, y: 2 } });
  });

  it('does nothing for an empty new text', () => {
    expect(
      resolveTextEdit([], { point: { x: 0, y: 0 }, value: ' ', editingId: null }, 'n', style),
    ).toBeNull();
  });

  it('updates the text of an edited shape, keeping its position and size', () => {
    const existing = { ...must(createTextShape({ x: 5, y: 5 }, 'Old', 't', style)), fontSize: 40 };
    const action = resolveTextEdit(
      [existing],
      { point: { x: 99, y: 99 }, value: 'New', editingId: 't' },
      'unused',
      style,
    );
    expect(action).toEqual({ type: 'update', shape: { ...existing, text: 'New' } });
  });

  it('removes an edited shape whose text was cleared', () => {
    const existing = must(createTextShape({ x: 5, y: 5 }, 'Old', 't', style));
    expect(
      resolveTextEdit(
        [existing],
        { point: { x: 5, y: 5 }, value: '', editingId: 't' },
        'unused',
        style,
      ),
    ).toEqual({ type: 'remove', id: 't' });
  });

  it('does nothing when the text is unchanged', () => {
    const existing = must(createTextShape({ x: 5, y: 5 }, 'Same', 't', style));
    expect(
      resolveTextEdit(
        [existing],
        { point: { x: 5, y: 5 }, value: 'Same', editingId: 't' },
        'unused',
        style,
      ),
    ).toBeNull();
  });
});
