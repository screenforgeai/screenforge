/**
 * Where the lens should focus before anyone chooses: the most detailed part of
 * the screenshot (text, controls), measured as local contrast on a small copy,
 * gently pulled toward the centre so an unremarkable edge never wins.
 */
import type { StudioPoint } from './looks';

const GRID_X = 12;
const GRID_Y = 8;
/** How strongly the centre is preferred (0 = not at all). */
const CENTRE_PULL = 0.45;
/** Below this, there is no detail worth focusing on: use the centre. */
const MIN_ENERGY = 4;

/** Focus point as fractions of the image (0,0 = top left), from its RGBA pixels. */
export const autoFocusPoint = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
): StudioPoint => {
  const energy = new Float64Array(GRID_X * GRID_Y);
  const lum = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const here = lum(i);
      const contrast = Math.abs(here - lum(i + 4)) + Math.abs(here - lum(i + width * 4));
      const cell = Math.floor((y / height) * GRID_Y) * GRID_X + Math.floor((x / width) * GRID_X);
      energy[cell] += contrast;
    }
  }
  const cellArea = (width * height) / (GRID_X * GRID_Y);
  let best = -1;
  let bestScore = 0;
  for (let gy = 0; gy < GRID_Y; gy++) {
    for (let gx = 0; gx < GRID_X; gx++) {
      const dx = (gx + 0.5) / GRID_X - 0.5;
      const dy = (gy + 0.5) / GRID_Y - 0.5;
      const pull = 1 - CENTRE_PULL * Math.min(1, (dx * dx + dy * dy) * 4);
      const score = (energy[gy * GRID_X + gx] / cellArea) * pull;
      if (score > bestScore) {
        bestScore = score;
        best = gy * GRID_X + gx;
      }
    }
  }
  if (best < 0 || bestScore < MIN_ENERGY) {
    return { x: 0.5, y: 0.5 };
  }
  return { x: ((best % GRID_X) + 0.5) / GRID_X, y: (Math.floor(best / GRID_X) + 0.5) / GRID_Y };
};
