import { createNativeCursorPointNormalizer } from './native-cursor-normalizer';

type Point = { x: number; y: number };

type DisplayLike = {
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
};

type OnModeResolved = Parameters<typeof createNativeCursorPointNormalizer>[1];

export interface NativeCursorPointMapperOptions {
  platform: NodeJS.Platform;
  /** Electron's screen.screenToDipPoint (Windows/Linux only). */
  screenToDipPoint?: (point: Point) => Point;
  onModeResolved?: OnModeResolved;
}

/**
 * Maps cursor points from the native capture helper into Electron's DIP
 * space, the space recordingArea and display bounds are in.
 *
 * Windows: the helper's low-level mouse hook reports physical pixels, and
 * Windows lays monitors out in physical pixels, so a monitor's physical origin
 * is not its DIP origin times its scale once two monitors have different
 * scale factors. Dividing the global point by the recorded display's scale
 * (the heuristic below) only works for a display at (0,0). Electron's
 * screenToDipPoint converts against the display that contains the point.
 *
 * macOS: the helper reports logical points already; the heuristic keeps them.
 */
export function createNativeCursorPointMapper(
  display: DisplayLike,
  options: NativeCursorPointMapperOptions,
): (x: number, y: number) => Point {
  const { platform, screenToDipPoint, onModeResolved } = options;
  if (platform === 'win32' && screenToDipPoint) {
    return (x, y) => {
      const dip = screenToDipPoint({ x: Math.round(x), y: Math.round(y) });
      return { x: dip.x, y: dip.y };
    };
  }
  return createNativeCursorPointNormalizer(display, onModeResolved);
}
