/**
 * Whole-recording motion values: the recording (with its frame, shadow and
 * cursor) moves, scales and tilts in 3D over the background. Overlays such as
 * text, the webcam bubble and captions stay put.
 */
export type SceneMotionProp = 'scale' | 'x' | 'y' | 'rotation' | 'tiltX' | 'tiltY' | 'opacity';

export type SceneMotionValues = Record<SceneMotionProp, number>;

interface MotionPropSpec {
  min: number;
  max: number;
  step: number;
  identity: number;
  /** How two poses stack: scaled (size, opacity) or offset (position, angles). */
  combine: 'multiply' | 'add';
}

export const SCENE_MOTION_PROPS: readonly SceneMotionProp[] = [
  'scale',
  'x',
  'y',
  'rotation',
  'tiltX',
  'tiltY',
  'opacity',
];

export const SCENE_MOTION_SPECS: Record<SceneMotionProp, MotionPropSpec> = {
  scale: { min: 0.2, max: 3, step: 0.01, identity: 1, combine: 'multiply' },
  // Offsets are fractions of the canvas width / height.
  x: { min: -1, max: 1, step: 0.005, identity: 0, combine: 'add' },
  y: { min: -1, max: 1, step: 0.005, identity: 0, combine: 'add' },
  rotation: { min: -180, max: 180, step: 0.5, identity: 0, combine: 'add' },
  tiltX: { min: -60, max: 60, step: 0.5, identity: 0, combine: 'add' },
  tiltY: { min: -60, max: 60, step: 0.5, identity: 0, combine: 'add' },
  opacity: { min: 0, max: 1, step: 0.01, identity: 1, combine: 'multiply' },
};

export const clampMotionProp = (prop: SceneMotionProp, value: number) => {
  const { min, max } = SCENE_MOTION_SPECS[prop];
  return Math.min(max, Math.max(min, value));
};

export const identityMotion = (): SceneMotionValues =>
  Object.fromEntries(
    SCENE_MOTION_PROPS.map((p) => [p, SCENE_MOTION_SPECS[p].identity]),
  ) as SceneMotionValues;

export function isIdentityMotion(values: SceneMotionValues): boolean {
  return SCENE_MOTION_PROPS.every(
    (p) => Math.abs(values[p] - SCENE_MOTION_SPECS[p].identity) < 1e-4,
  );
}

/** Stacks pose `b` on top of pose `a`. */
export function combineMotion(a: SceneMotionValues, b: SceneMotionValues): SceneMotionValues {
  const out = {} as SceneMotionValues;
  for (const p of SCENE_MOTION_PROPS) {
    out[p] = clampMotionProp(
      p,
      SCENE_MOTION_SPECS[p].combine === 'multiply' ? a[p] * b[p] : a[p] + b[p],
    );
  }
  return out;
}

export function lerpMotion(
  a: SceneMotionValues,
  b: SceneMotionValues,
  k: number,
): SceneMotionValues {
  const out = {} as SceneMotionValues;
  for (const p of SCENE_MOTION_PROPS) {
    out[p] = a[p] + (b[p] - a[p]) * k;
  }
  return out;
}
