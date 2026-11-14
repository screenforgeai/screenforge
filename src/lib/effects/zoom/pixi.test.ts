import { describe, expect, it } from 'vitest';
import {
  resolveCinematicCameraTransform,
  resolveCinematicContentBounds,
  resolveCinematicFilterSettings,
  resolveCinematicFocusPoint,
  resolveCinematicPerspectiveSettings,
  resolveCinematicTilt,
  resolveCinematicTiltFocusTarget,
  resolvePixelSnappedZoomTransform,
  resolveSourceTimeAtTimelineTime,
  resolveStabilizedCinematicFocus,
  shouldEnableCinematicFilter,
  type StabilizedCinematicFocusState,
  transformPointWithCameraTransform,
} from './pixi';

describe('resolvePixelSnappedZoomTransform', () => {
  it('snaps final zoom translation to the renderer pixel grid', () => {
    const transform = resolvePixelSnappedZoomTransform(10.3, 20.3, 2, 2);

    expect(transform).toEqual({
      pivotX: 0,
      pivotY: 0,
      positionX: -10.5,
      positionY: -20.5,
      scale: 2,
    });
  });

  it('keeps the focus point visually stable after snapping', () => {
    const pivotX = 417.2;
    const scale = 2.4;
    const transform = resolvePixelSnappedZoomTransform(pivotX, 0, scale, 2);
    const focusedScreenX = pivotX * transform.scale + transform.positionX;

    expect(Math.abs(focusedScreenX - pivotX)).toBeLessThanOrEqual(0.25);
  });
});

describe('resolveCinematicTilt', () => {
  it('keeps standard zoom flat', () => {
    const tilt = resolveCinematicTilt(0);

    expect(tilt).toEqual({
      amount: 0,
      rotation: 0,
      skewX: 0,
      skewY: 0,
    });
  });

  it('faces the cinematic tilt toward the focus point', () => {
    const leftTilt = resolveCinematicTilt(1, { nx: 0.15, ny: 0.5 });
    const rightTilt = resolveCinematicTilt(1, { nx: 0.85, ny: 0.5 });

    expect(leftTilt.amount).toBe(1);
    expect(rightTilt.amount).toBe(1);
    expect(leftTilt.rotation).toBeGreaterThan(0);
    expect(rightTilt.rotation).toBeLessThan(0);
    expect(leftTilt.skewY).toBe(0);
    expect(rightTilt.skewY).toBe(0);
  });

  it('lets the tilt control turn the plane fully flat', () => {
    const tilt = resolveCinematicTilt(1, { nx: 0.85, ny: 0.35 }, 0);

    expect(tilt).toEqual({
      amount: 0,
      rotation: 0,
      skewX: 0,
      skewY: 0,
    });
  });

  it('keeps top-bottom tilt continuous around the vertical center', () => {
    const slightlyAbove = resolveCinematicTilt(1, { nx: 0.5, ny: 0.49 });
    const slightlyBelow = resolveCinematicTilt(1, { nx: 0.5, ny: 0.51 });

    expect(Math.abs(slightlyAbove.skewX)).toBeLessThan(0.003);
    expect(Math.abs(slightlyBelow.skewX)).toBeLessThan(0.003);
    expect(Math.abs(slightlyBelow.skewX - slightlyAbove.skewX)).toBeLessThan(0.004);
  });

  it('uses the tilt control to increase cinematic perspective', () => {
    const shallow = resolveCinematicTilt(1, { nx: 0.85, ny: 0.6 }, 0.1);
    const medium = resolveCinematicTilt(1, { nx: 0.85, ny: 0.6 }, 0.65);
    const deep = resolveCinematicTilt(1, { nx: 0.85, ny: 0.6 }, 1);

    expect(Math.abs(medium.rotation)).toBeGreaterThan(Math.abs(shallow.rotation));
    expect(Math.abs(deep.rotation)).toBeGreaterThan(Math.abs(medium.rotation));
    expect(Math.abs(deep.rotation)).toBeGreaterThan(Math.abs(shallow.rotation));
  });

  it('keeps vertical cursor movement from dominating the tilt', () => {
    const horizontal = resolveCinematicTilt(1, { nx: 0.9, ny: 0.5 }, 0.65);
    const vertical = resolveCinematicTilt(1, { nx: 0.5, ny: 0.9 }, 0.65);

    expect(Math.abs(vertical.rotation)).toBeLessThan(Math.abs(horizontal.rotation) * 0.15);
  });

  it('keeps enough rotation for the near side to read as pulled forward', () => {
    const tilt = resolveCinematicTilt(0.65, { nx: 0.85, ny: 0.52 }, 0.65);

    expect(Math.abs(tilt.rotation)).toBeGreaterThan(0.02);
  });
});

describe('resolveCinematicCameraTransform', () => {
  it('uses a focus-point pivot when tilt is active', () => {
    const tilt = resolveCinematicTilt(0.8);
    const transform = resolveCinematicCameraTransform(417.2, 320.4, 2.4, 2, tilt);

    expect(transform.pivotX).toBe(417.2);
    expect(transform.pivotY).toBe(320.4);
    expect(transform.positionX).toBe(417);
    expect(transform.positionY).toBe(320.5);
    expect(transform.rotation).toBeLessThan(0);
    expect(transform.skewX).toBe(0);
  });
});

describe('resolveCinematicContentBounds', () => {
  it('expands transformed preview bounds without clamping them to the viewport', () => {
    const tilt = resolveCinematicTilt(0.9, { nx: 0.1, ny: 0.5 }, 1);
    const transform = resolveCinematicCameraTransform(960, 540, 2.2, 1, tilt);
    const bounds = resolveCinematicContentBounds(
      { x: 240, y: 160, width: 1440, height: 760 },
      transform,
      1920,
      1080,
    );

    expect(bounds.minX).toBeLessThan(0);
    expect(bounds.maxX).toBeGreaterThan(1920);
    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    expect(bounds.maxY).toBeGreaterThan(bounds.minY);
  });

  it('preserves the far-side bounds when cinematic focus is on the left', () => {
    const tilt = resolveCinematicTilt(1, { nx: 0.12, ny: 0.5 }, 1);
    const transform = resolveCinematicCameraTransform(220, 540, 1.9, 1, tilt);
    const bounds = resolveCinematicContentBounds(
      { x: 0, y: 80, width: 1720, height: 920 },
      transform,
      1920,
      1080,
    );

    expect(bounds.maxX).toBeGreaterThan(1920);
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(1920);
  });
});

describe('resolveCinematicFocusPoint', () => {
  it('maps the cursor focus into padded canvas space', () => {
    const point = resolveCinematicFocusPoint(0.75, 0.25, 1920, 1080, 0.1);

    expect(point.x).toBeCloseTo(1392);
    expect(point.y).toBeCloseTo(297);
  });
});

describe('resolveCinematicFilterSettings', () => {
  it('resolves cursor-centered focus fade settings for cinematic zoom', () => {
    const settings = resolveCinematicFilterSettings(0.65, 960, 540, 2.2, 1920, 1080, {
      focus: 0.75,
      motionBlur: 0.2,
      depth: 0.85,
      backgroundFade: 0.9,
    });

    expect(settings.enabled).toBe(true);
    expect(settings.centerX).toBe(960);
    expect(settings.centerY).toBe(540);
    expect(settings.innerRadius).toBeGreaterThan(0);
    expect(settings.innerRadius).toBeGreaterThan(250);
    expect(settings.strength).toBe(0);
    expect(settings.farBlurPixels).toBe(0);
    expect(settings.depthAmount).toBeGreaterThan(0);
    expect(settings.depthAmount).toBeGreaterThan(0.64);
    expect(settings.depthAmount).toBeLessThan(0.66);
    expect(settings.depthAmount).toBeLessThanOrEqual(1);
    expect(settings.fadeAmount).toBeCloseTo(1.485);
    expect(settings.splitX).toBe(0);
    expect(settings.splitY).toBe(0);
    expect(settings.chromaticEnabled).toBe(false);
    expect(settings.contrast).toBe(1);
    expect(settings.saturation).toBe(1);
    expect(settings.brightness).toBe(1);
  });
});

describe('cinematic filter performance helpers', () => {
  it('keeps the cinematic filter gated only by cinematic amount', () => {
    expect(shouldEnableCinematicFilter(0.001, 0.001)).toBe(false);
    expect(shouldEnableCinematicFilter(0.005, 0)).toBe(true);
    expect(shouldEnableCinematicFilter(0, 0.02)).toBe(false);
  });
});

describe('resolveCinematicPerspectiveSettings', () => {
  it('resolves tilt-controlled perspective from cinematic amount', () => {
    const shallow = resolveCinematicPerspectiveSettings(
      0.75,
      { nx: 0.85, ny: 0.48 },
      0.1,
      1920,
      1080,
    );
    const deep = resolveCinematicPerspectiveSettings(0.75, { nx: 0.85, ny: 0.48 }, 1, 1920, 1080);

    expect(shallow.enabled).toBe(true);
    expect(deep.amount).toBeGreaterThan(shallow.amount);
    expect(deep.focusX).toBeCloseTo(0.52);
    expect(deep.focusY).toBeCloseTo(0.5);
    expect(deep.aspect).toBeCloseTo(16 / 9);
  });

  it('turns off perspective when tilt is zero', () => {
    const settings = resolveCinematicPerspectiveSettings(1, { nx: 0.85, ny: 0.48 }, 0, 1920, 1080);

    expect(settings.enabled).toBe(false);
    expect(settings.amount).toBe(0);
  });

  it('turns off perspective outside cinematic motion', () => {
    const settings = resolveCinematicPerspectiveSettings(0, { nx: 0.85, ny: 0.48 }, 1, 1920, 1080);

    expect(settings.enabled).toBe(false);
    expect(settings.amount).toBe(0);
  });
});

describe('resolveCinematicTiltFocusTarget', () => {
  it('locks static cinematic tilt to the clip start focus', () => {
    const cache = new Map<string, { nx: number; ny: number }>();

    const locked = resolveCinematicTiltFocusTarget(
      { nx: 0.82, ny: 0.48 },
      {
        tiltMode: 'static',
        clipId: 'zoom-cinematic',
        clipStart: 4,
        mode: 'auto',
        cache,
        resolveStartFocus: () => ({ nx: 0.22, ny: 0.62 }),
      },
    );
    const stillLocked = resolveCinematicTiltFocusTarget(
      { nx: 0.9, ny: 0.2 },
      {
        tiltMode: 'static',
        clipId: 'zoom-cinematic',
        clipStart: 4,
        mode: 'auto',
        cache,
        resolveStartFocus: () => ({ nx: 0.7, ny: 0.1 }),
      },
    );

    expect(locked).toEqual({ nx: 0.22, ny: 0.62 });
    expect(stillLocked).toEqual({ nx: 0.22, ny: 0.62 });
  });

  it('locks the focus again when the crop changes, since it is a position in the crop', () => {
    const cache = new Map<string, { nx: number; ny: number }>();
    const lock = (crop: { x: number; y: number; width: number; height: number }, ny: number) =>
      resolveCinematicTiltFocusTarget(
        { nx: 0.5, ny: 0.5 },
        {
          tiltMode: 'static',
          clipId: 'zoom-cinematic',
          clipStart: 4,
          mode: 'auto',
          crop,
          cache,
          resolveStartFocus: () => ({ nx: 0.5, ny }),
        },
      );

    const full = { x: 0, y: 0, width: 1, height: 1 };
    const area = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    expect(lock(full, 0.3)).toEqual({ nx: 0.5, ny: 0.3 });
    expect(lock(area, 0.7)).toEqual({ nx: 0.5, ny: 0.7 });
    // Back to a crop seen before: its own locked focus, not the other crop's.
    expect(lock(full, 0.9)).toEqual({ nx: 0.5, ny: 0.3 });
  });

  it('returns current focus for follow mode without caching', () => {
    const cache = new Map<string, { nx: number; ny: number }>();

    const target = resolveCinematicTiltFocusTarget(
      { nx: 0.82, ny: 0.48 },
      {
        tiltMode: 'follow' as unknown as 'static',
        clipId: 'zoom-cinematic',
        clipStart: 4,
        mode: 'auto',
        cache,
        resolveStartFocus: () => ({ nx: 0.22, ny: 0.62 }),
      },
    );

    expect(target).toEqual({ nx: 0.82, ny: 0.48 });
    expect(cache.size).toBe(0);
  });
});

describe('resolveSourceTimeAtTimelineTime', () => {
  it('maps a zoom clip timeline start back to source time for split media segments', () => {
    const sourceTime = resolveSourceTimeAtTimelineTime(12, [
      {
        id: 'seg-1',
        timelineStart: 10,
        timelineEnd: 20,
        sourceStart: 30,
        sourceEnd: 40,
      },
    ]);

    expect(sourceTime).toBe(32);
  });
});

describe('resolveStabilizedCinematicFocus', () => {
  function createState(): StabilizedCinematicFocusState {
    return {
      nx: 0.5,
      ny: 0.5,
      velNx: 0,
      velNy: 0,
      initialized: false,
    };
  }

  it('damps sudden left-to-right focus jumps for cinematic tilt', () => {
    const state = createState();

    resolveStabilizedCinematicFocus(state, { nx: 0.1, ny: 0.5 }, 1, 0);
    const firstFrame = resolveStabilizedCinematicFocus(state, { nx: 0.9, ny: 0.5 }, 1, 1 / 60);

    expect(firstFrame.nx).toBeGreaterThan(0.1);
    expect(firstFrame.nx).toBeLessThan(0.2);

    let settled = firstFrame;
    for (let frame = 0; frame < 60; frame += 1) {
      settled = resolveStabilizedCinematicFocus(state, { nx: 0.9, ny: 0.5 }, 1, 1 / 60);
    }

    expect(settled.nx).toBeGreaterThan(0.89);
    expect(Math.abs(settled.ny - 0.5)).toBeLessThan(0.001);
  });

  it('damps vertical focus changes more strongly than horizontal changes', () => {
    const state = createState();

    resolveStabilizedCinematicFocus(state, { nx: 0.1, ny: 0.1 }, 1, 0);
    const firstFrame = resolveStabilizedCinematicFocus(state, { nx: 0.9, ny: 0.9 }, 1, 1 / 60);

    expect(firstFrame.nx - 0.1).toBeGreaterThan(firstFrame.ny - 0.1);
  });

  it('resets outside cinematic clips so stale tilt state is not carried forward', () => {
    const state: StabilizedCinematicFocusState = {
      nx: 0.15,
      ny: 0.2,
      velNx: 3,
      velNy: -2,
      initialized: true,
    };

    const focus = resolveStabilizedCinematicFocus(state, { nx: 0.75, ny: 0.65 }, 0, 1 / 60);

    expect(focus).toEqual({ nx: 0.75, ny: 0.65 });
    expect(state).toEqual({
      nx: 0.75,
      ny: 0.65,
      velNx: 0,
      velNy: 0,
      initialized: false,
    });
  });
});

describe('transformPointWithCameraTransform', () => {
  it('keeps the focus point stable around a cinematic pivot', () => {
    const tilt = resolveCinematicTilt(0.8, { nx: 0.8, ny: 0.4 });
    const transform = resolveCinematicCameraTransform(400, 300, 2, 1, tilt);
    const point = transformPointWithCameraTransform(400, 300, transform);

    expect(point.x).toBeCloseTo(400);
    expect(point.y).toBeCloseTo(300);
  });
});
