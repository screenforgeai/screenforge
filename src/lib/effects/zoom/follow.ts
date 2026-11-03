function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const DEAD_ZONE = 0.3;
const FOLLOW_HYSTERESIS = 0.03;
const FOLLOW_BIAS_CAP = 0.08;
const FOLLOW_LEAD_CAP = 0.06;
const FOLLOW_LOOKAHEAD = 0.075;

export type FollowDirection = -1 | 0 | 1;

export interface AutoFollowAxisResult {
  nextDirection: FollowDirection;
  minEdge: number;
  maxEdge: number;
  lead: number;
  target: number | null;
}

export function resolveAutoFollowAxis(
  cursorScreen: number,
  cursorContent: number,
  scale: number,
  velocity: number,
  direction: FollowDirection,
): AutoFollowAxisResult {
  const bias = clamp(velocity * FOLLOW_LOOKAHEAD, -FOLLOW_BIAS_CAP, FOLLOW_BIAS_CAP);
  const minEdge = clamp(DEAD_ZONE + bias, 0.12, 0.72);
  const maxEdge = clamp(1 - DEAD_ZONE + bias, minEdge + 0.08, 0.88);

  let nextDirection = direction;
  if (direction === 0) {
    if (cursorScreen < minEdge - FOLLOW_HYSTERESIS) {
      nextDirection = -1;
    } else if (cursorScreen > maxEdge + FOLLOW_HYSTERESIS) {
      nextDirection = 1;
    }
  } else if (direction < 0 && cursorScreen >= minEdge + FOLLOW_HYSTERESIS) {
    nextDirection = 0;
  } else if (direction > 0 && cursorScreen <= maxEdge - FOLLOW_HYSTERESIS) {
    nextDirection = 0;
  }

  const lead = clamp(velocity * FOLLOW_LOOKAHEAD, -FOLLOW_LEAD_CAP, FOLLOW_LEAD_CAP);
  const ledCursor = clamp(cursorContent + lead, 0, 1);

  if (scale <= 1.001 || nextDirection === 0) {
    return { nextDirection, minEdge, maxEdge, lead, target: null };
  }

  const edge = nextDirection < 0 ? minEdge : maxEdge;
  return {
    nextDirection,
    minEdge,
    maxEdge,
    lead,
    target: (scale * ledCursor - edge) / (scale - 1),
  };
}
