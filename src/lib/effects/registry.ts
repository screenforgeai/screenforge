import type { Effect } from './types';
import { cameraEffect } from './camera/index';
import { captionsEffect } from './captions/index';
import { cursorEffect } from './cursor/index';
import { frameEffect } from './frame/index';
import { keyboardEffect } from './keyboard/index';
import { maskEffect } from './mask/index';
import { zoomEffect } from './zoom/index';
import { textEffect } from './text/index';

/**
 * All active effects in draw order.
 * reduceRight makes the last element the innermost wrapper.
 * zoomEffect must be first (outermost) so zoom transforms the entire framed scene.
 * frameEffect runs next. Cursor is an overlay layer that maps through
 * frame+zoom transforms so it can bleed outside clipped media edges.
 */
export const effectRegistry: Effect<unknown>[] = [
  zoomEffect as Effect<unknown>,
  frameEffect as Effect<unknown>,
  cursorEffect as Effect<unknown>,
  cameraEffect as Effect<unknown>,
  keyboardEffect as Effect<unknown>,
  captionsEffect as Effect<unknown>,
  textEffect as Effect<unknown>,
  maskEffect as Effect<unknown>,
];
