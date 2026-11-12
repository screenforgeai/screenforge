/**
 * Where the screenshot sits in the studio, as the user moves it: a 2D shift
 * (fractions of the output, at the screenshot's own depth, so a drag follows
 * the pointer 1:1) and a depth along the camera's line of sight.
 */
import type { StudioPoint } from './looks';

/** How far past the frame the screenshot may go, in output widths/heights from centre. */
export const MAX_OFFSET = 1.5;
/**
 * Depth: the share of the camera's distance the screenshot has moved toward it.
 * 0 is the look's own framing; 0.85 is very close (15% of the distance left);
 * -3 is four times as far.
 */
export const MAX_DEPTH = 0.85;
export const MIN_DEPTH = -3;
/** Distance change per wheel pixel: about 15% per notch of a mouse wheel. */
const WHEEL_RATE = 0.0015;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clampOffset = (offset: StudioPoint): StudioPoint => ({
  x: clamp(offset.x, -MAX_OFFSET, MAX_OFFSET),
  y: clamp(offset.y, -MAX_OFFSET, MAX_OFFSET),
});

/**
 * Depth after a wheel (or trackpad pinch) step. The distance to the camera is
 * scaled, not shifted, so each notch feels the same near and far.
 */
export const depthAfterWheel = (depth: number, deltaY: number): number => {
  const distance = (1 - depth) * Math.exp(deltaY * WHEEL_RATE);
  return clamp(1 - distance, MIN_DEPTH, MAX_DEPTH);
};

/**
 * The camera's turn around the screenshot, added to the look's own angle
 * (radians): x around the vertical axis, y up/down. It stops short of the
 * screenshot's edge, and of looking at it from below the floor.
 */
export const MAX_ORBIT_X = 1.3;
export const MAX_ORBIT_UP = 1.0;
export const MAX_ORBIT_DOWN = 0.12;
/** How far the camera turns for a drag across the whole output, radians. */
const ORBIT_PER_WIDTH = Math.PI;
const ORBIT_PER_HEIGHT = Math.PI / 2;

/**
 * Orbit after a drag of (dx, dy) fractions of the output. Dragging right turns
 * the camera to the left of the screenshot (the scene turns with the pointer),
 * dragging down raises it.
 */
export const orbitAfterDrag = (orbit: StudioPoint, dx: number, dy: number): StudioPoint => ({
  x: clamp(orbit.x - dx * ORBIT_PER_WIDTH, -MAX_ORBIT_X, MAX_ORBIT_X),
  y: clamp(orbit.y + dy * ORBIT_PER_HEIGHT, -MAX_ORBIT_DOWN, MAX_ORBIT_UP),
});

/** Camera distance as a share of the look's own (1). Lower is closer. */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.5;

/** Zoom after a wheel step: the distance is scaled, so each notch feels the same. */
export const zoomAfterWheel = (zoom: number, deltaY: number): number =>
  clamp(zoom * Math.exp(deltaY * WHEEL_RATE), MIN_ZOOM, MAX_ZOOM);

/** Sharp area around the focus point, 0..1 (0 = only the focus plane is sharp). */
export const focusRangeAfterWheel = (range: number, deltaY: number): number =>
  clamp(range - deltaY * 0.001, 0, 1);

/** Light strength as a share of the look's own (1). */
export const MIN_LIGHT_POWER = 0.4;
export const MAX_LIGHT_POWER = 2;

export const lightPowerAfterWheel = (power: number, deltaY: number): number =>
  clamp(power * Math.exp(-deltaY * WHEEL_RATE), MIN_LIGHT_POWER, MAX_LIGHT_POWER);
