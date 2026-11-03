type CoordinateMode = 'logical' | 'scaled';

type DisplayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DisplayLike = {
  bounds: DisplayBounds;
  scaleFactor: number;
};

type ModeResolvedInfo = {
  mode: CoordinateMode;
  scaleFactor: number;
  logicalHits: number;
  scaledHits: number;
  samples: number;
};

/**
 * Creates a point normalizer that auto-detects whether native cursor coordinates
 * are emitted in logical space or in scale-factor-adjusted space.
 */
export function createNativeCursorPointNormalizer(
  display: DisplayLike,
  onModeResolved?: (info: ModeResolvedInfo) => void,
): (x: number, y: number) => { x: number; y: number } {
  const scaleFactor = display.scaleFactor > 0 ? display.scaleFactor : 1;
  const bounds = display.bounds;
  const boundsPad = 2;
  const isWithinDisplayBounds = (x: number, y: number): boolean =>
    x >= bounds.x - boundsPad &&
    x <= bounds.x + bounds.width + boundsPad &&
    y >= bounds.y - boundsPad &&
    y <= bounds.y + bounds.height + boundsPad;

  let coordinateMode: CoordinateMode = 'logical';
  let coordinateModeResolved = scaleFactor === 1;
  let logicalHits = 0;
  let scaledHits = 0;
  let inspectedPoints = 0;
  const COORDINATE_MODE_SAMPLES = 8;

  const resolveCoordinateMode = (rawX: number, rawY: number): CoordinateMode => {
    if (coordinateModeResolved || scaleFactor === 1) {
      return coordinateMode;
    }

    inspectedPoints += 1;
    if (isWithinDisplayBounds(rawX, rawY)) {
      logicalHits += 1;
    }
    if (isWithinDisplayBounds(rawX / scaleFactor, rawY / scaleFactor)) {
      scaledHits += 1;
    }

    const enoughSamples = inspectedPoints >= COORDINATE_MODE_SAMPLES;
    const decisive = Math.abs(logicalHits - scaledHits) >= 3;
    if (enoughSamples || decisive) {
      coordinateMode = scaledHits > logicalHits ? 'scaled' : 'logical';
      coordinateModeResolved = true;
      onModeResolved?.({
        mode: coordinateMode,
        scaleFactor,
        logicalHits,
        scaledHits,
        samples: inspectedPoints,
      });
    }

    return coordinateMode;
  };

  return (x: number, y: number): { x: number; y: number } => {
    const mode = resolveCoordinateMode(x, y);
    if (mode === 'scaled') {
      return { x: x / scaleFactor, y: y / scaleFactor };
    }
    return { x, y };
  };
}
