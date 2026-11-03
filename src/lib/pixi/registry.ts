import type { PixiEffect } from './types';
import { zoomPixiEffect } from '../effects/zoom/pixi';
import { framePixiEffect } from '../effects/frame/pixi';
import { cursorPixiEffect } from '../effects/cursor/pixi';
import { cameraPixiEffect } from '../effects/camera/pixi';
import { keyboardPixiEffect } from '../effects/keyboard/pixi';
import { captionsPixiEffect } from '../effects/captions/pixi';
import { textPixiEffect } from '../effects/text/pixi';
import { maskPixiEffect } from '../effects/mask/pixi';

/**
 * All active PixiJS effects in execution order.
 *
 * Order matters for updater execution:
 *   1. zoom   — writes sharedCameraState.cx/cy before other effects read it
 *   2. frame  — background + video sprite, independent of zoom state
 *   3. mask   — added to overlayContainer before cursor/overlays so it renders beneath them
 *   4. cursor — reads sharedCameraState for zoom-pivot-aware placement
 *   5. camera — reads interpolateCamera directly, independent
 */
export const pixiEffectRegistry: PixiEffect<unknown>[] = [
  zoomPixiEffect as PixiEffect<unknown>,
  framePixiEffect as PixiEffect<unknown>,
  maskPixiEffect as PixiEffect<unknown>,
  cursorPixiEffect as PixiEffect<unknown>,
  cameraPixiEffect as PixiEffect<unknown>,
  keyboardPixiEffect as PixiEffect<unknown>,
  captionsPixiEffect as PixiEffect<unknown>,
  textPixiEffect as PixiEffect<unknown>,
];
