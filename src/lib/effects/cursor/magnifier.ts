import { Matrix } from 'pixi.js';

/**
 * Transforms for the cursor magnifier, in the cursor layer's own space.
 *
 * - `lens` places the recording's video texture, zoomed by `zoom` about the
 *   cursor (cx, cy).
 * - `clip` places the frame's crop mask with exactly the same zoom, so the lens
 *   shows what the crop shows (magnified) and never a pixel the crop hides.
 *
 * Inputs are global transforms: the cursor layer's, the recording sprite's and
 * the crop mask's. Pass `out` to reuse matrices every frame.
 */
export function computeMagnifierTransforms(
  layerGlobal: Matrix,
  recordingGlobal: Matrix,
  maskGlobal: Matrix,
  cx: number,
  cy: number,
  zoom: number,
  out: { lens: Matrix; clip: Matrix } = { lens: new Matrix(), clip: new Matrix() },
): { lens: Matrix; clip: Matrix } {
  out.lens
    .copyFrom(layerGlobal)
    .invert()
    .append(recordingGlobal)
    .translate(-cx, -cy)
    .scale(zoom, zoom)
    .translate(cx, cy);
  out.clip
    .copyFrom(layerGlobal)
    .invert()
    .append(maskGlobal)
    .translate(-cx, -cy)
    .scale(zoom, zoom)
    .translate(cx, cy);
  return out;
}
