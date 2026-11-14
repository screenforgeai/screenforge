type Rect = { x: number; y: number; width: number; height: number };
type Size = { width: number; height: number };

/** Arrow keys move a selection 1px; with Shift, 10px. */
const STEP = 1;
const STEP_FAST = 10;

const DIRECTIONS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The selection moved by an arrow key, kept inside the viewport; null for any
 * other key.
 */
export const nudgeForKey = <T extends Rect>(
  rect: T,
  key: string,
  fast: boolean,
  viewport: Size,
): T | null => {
  const direction = DIRECTIONS[key];
  if (!direction) {
    return null;
  }
  const step = fast ? STEP_FAST : STEP;
  return {
    ...rect,
    x: Math.max(0, Math.min(viewport.width - rect.width, rect.x + direction[0] * step)),
    y: Math.max(0, Math.min(viewport.height - rect.height, rect.y + direction[1] * step)),
  };
};
