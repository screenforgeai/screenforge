import { describe, expect, it } from 'vitest';
import { defaultZoomClip } from './analyze';
import { normalizeZoomClip } from './clip';
import { resolveAutoFollowAxis } from './follow';
import { interpolateCamera, resolveCinematicZoomState } from './render';

describe('interpolateCamera', () => {
  it('keeps auto mode stable near scale 1', () => {
    const clip = defaultZoomClip('zoom-1', 0, 2, 0.5, 0.5, 2);

    const state = interpolateCamera([clip], 0.05, { nx: 0.82, ny: 0.24 });
    expect(state).not.toBeNull();
    expect(state?.scale).toBeGreaterThan(1);
    expect(state?.cx).toBeGreaterThan(0.75);
    expect(state?.cx).toBeLessThan(1.25);
  });

  it('does not jump the camera target when auto zoom is barely above 1x', () => {
    const clip = defaultZoomClip('zoom-edge', 0, 2, 0.5, 0.5, 2.6);

    const state = interpolateCamera([clip], 0.01, { nx: 0.92, ny: 0.5 });

    expect(state).not.toBeNull();
    expect(state?.scale).toBeGreaterThan(1);
    expect(state?.cx).toBeGreaterThan(0.91);
    expect(state?.cx).toBeLessThan(0.94);
  });

  it('preserves manual center for manual clips', () => {
    const clip = {
      ...defaultZoomClip('zoom-2', 0, 2, 0.2, 0.75, 2.4),
      mode: 'manual' as const,
    };

    const state = interpolateCamera([clip], 1.0, { nx: 0.9, ny: 0.1 });
    expect(state).toMatchObject({
      cx: 0.2,
      cy: 0.75,
      mode: 'manual',
    });
  });

  it('bridges close zoom clips instead of dropping fully back to 1x between them', () => {
    const clips = [
      {
        ...defaultZoomClip('zoom-a', 0, 1.6, 0.35, 0.4, 2.2),
        mode: 'auto' as const,
      },
      {
        ...defaultZoomClip('zoom-b', 1.9, 3.1, 0.62, 0.46, 2),
        mode: 'auto' as const,
      },
    ];

    const inGap = interpolateCamera(clips, 1.75, { nx: 0.5, ny: 0.45 });
    const nearExit = interpolateCamera(clips, 1.55, { nx: 0.5, ny: 0.45 });

    expect(inGap).not.toBeNull();
    expect(inGap?.scale).toBeGreaterThan(1.35);
    expect(nearExit).not.toBeNull();
    expect(nearExit?.scale).toBeGreaterThan(1.35);
  });
});

describe('normalizeZoomClip', () => {
  it('defaults legacy clips to standard cinematic settings', () => {
    const clip = normalizeZoomClip({
      id: 'legacy',
      start: 0,
      end: 2,
      scale: 2,
      cx: 0.5,
      cy: 0.5,
      easeIn: 0.6,
      easeOut: 0.8,
      mode: 'auto',
    });

    expect(clip.preset).toBe('standard');
    expect(clip.cinematicIntensity).toBe(0.65);
    expect(clip.cinematicDepth).toBe(0.65);
    expect(clip.cinematicFocus).toBe(0.75);
    expect(clip.cinematicBackgroundFade).toBe(0.75);
    expect(clip.cinematicTilt).toBe(0.65);
    expect(clip.cinematicMotionBlur).toBe(0.2);
    expect(clip.cinematicTiltMode).toBe('follow');
  });

  it('preserves follow tilt mode through normalization', () => {
    const clip = normalizeZoomClip({
      ...defaultZoomClip('follow', 0, 2, 0.5, 0.5, 2),
      cinematicTiltMode: 'follow',
    });

    expect(clip.cinematicTiltMode).toBe('follow');
  });
});

describe('resolveCinematicZoomState', () => {
  it('is inactive outside cinematic clips', () => {
    const clip = {
      ...defaultZoomClip('zoom-cinematic', 0, 2, 0.4, 0.5, 2),
      preset: 'cinematic' as const,
      cinematicIntensity: 0.5,
    };

    expect(resolveCinematicZoomState([clip], 2.5).amount).toBe(0);
  });

  it('ramps amount with the zoom easing envelope', () => {
    const clip = {
      ...defaultZoomClip('zoom-cinematic', 0, 2, 0.4, 0.5, 2),
      preset: 'cinematic' as const,
      cinematicIntensity: 0.6,
    };

    const entering = resolveCinematicZoomState([clip], 0.3);
    const held = resolveCinematicZoomState([clip], 1.0);

    expect(entering.amount).toBeGreaterThan(0);
    expect(entering.amount).toBeLessThan(held.amount);
    expect(held.amount).toBeCloseTo(1);
    expect(held.depth).toBeCloseTo(0.65);
    expect(held.focus).toBeCloseTo(0.75);
    expect(held.tilt).toBeCloseTo(0.65);
    expect(held.motionBlur).toBeCloseTo(0.2);
    expect(held.tiltMode).toBe('follow');
  });

  it('keeps tilt active even when removed cinematic look config was saved as zero', () => {
    const clip = {
      ...defaultZoomClip('zoom-cinematic', 0, 2, 0.4, 0.5, 2),
      preset: 'cinematic' as const,
      cinematicIntensity: 0,
    };

    const state = resolveCinematicZoomState([clip], 1.0);

    expect(state.amount).toBeCloseTo(1);
  });

  it('uses a minimum cinematic ramp even when zoom ease is instant', () => {
    const clip = {
      ...defaultZoomClip('zoom-cinematic', 0, 2, 0.4, 0.5, 2),
      preset: 'cinematic' as const,
      cinematicIntensity: 1,
      easeIn: 0,
      easeOut: 0,
    };

    const justStarted = resolveCinematicZoomState([clip], 0.05);
    const held = resolveCinematicZoomState([clip], 1.0);
    const almostEnded = resolveCinematicZoomState([clip], 1.95);

    expect(justStarted.amount).toBeGreaterThan(0);
    expect(justStarted.amount).toBeLessThan(0.2);
    expect(held.amount).toBeCloseTo(1);
    expect(almostEnded.amount).toBeGreaterThan(0);
    expect(almostEnded.amount).toBeLessThan(0.2);
  });

  it('carries cinematic controls into the render state', () => {
    const clip = {
      ...defaultZoomClip('zoom-cinematic', 0, 2, 0.4, 0.5, 2),
      preset: 'cinematic' as const,
      cinematicDepth: 0.85,
      cinematicFocus: 0.45,
      cinematicBackgroundFade: 0.9,
      cinematicTilt: 0.35,
      cinematicMotionBlur: 0.2,
      cinematicTiltMode: 'static' as const,
    };

    const state = resolveCinematicZoomState([clip], 1.0, { nx: 0.5, ny: 0.5 });

    expect(state.clipId).toBe('zoom-cinematic');
    expect(state.clipStart).toBe(0);
    expect(state.depth).toBeCloseTo(0.85);
    expect(state.focus).toBeCloseTo(0.45);
    expect(state.backgroundFade).toBeCloseTo(0.9);
    expect(state.tilt).toBeCloseTo(0.35);
    expect(state.motionBlur).toBeCloseTo(0.2);
    expect(state.tiltMode).toBe('static');
  });

  it('uses manual focus for manual cinematic clips', () => {
    const clip = {
      ...defaultZoomClip('zoom-cinematic', 0, 2, 0.25, 0.7, 2.2),
      mode: 'manual' as const,
      preset: 'cinematic' as const,
    };

    const state = resolveCinematicZoomState([clip], 1.0, { nx: 0.9, ny: 0.1 });

    expect(state.cx).toBe(0.25);
    expect(state.cy).toBe(0.7);
    expect(state.focusCx).toBe(0.25);
    expect(state.focusCy).toBe(0.7);
  });

  it('uses the cursor position as the sharp focus for auto cinematic clips', () => {
    const clip = {
      ...defaultZoomClip('zoom-cinematic', 0, 2, 0.5, 0.5, 2),
      preset: 'cinematic' as const,
    };

    const state = resolveCinematicZoomState([clip], 1.0, { nx: 0.8, ny: 0.2 });

    expect(state.cx).toBeCloseTo(0.8);
    expect(state.cy).toBeCloseTo(0.2);
    expect(state.focusCx).toBeCloseTo(0.8);
    expect(state.focusCy).toBeCloseTo(0.2);
  });
});

describe('resolveAutoFollowAxis', () => {
  it('adds directional bias and lead for forward motion', () => {
    const result = resolveAutoFollowAxis(0.82, 0.78, 2, 1.1, 0);
    expect(result.nextDirection).toBe(1);
    expect(result.maxEdge).toBeGreaterThan(0.7);
    expect(result.lead).toBeGreaterThan(0);
    expect(result.target).not.toBeNull();
  });

  it('uses hysteresis before disengaging follow', () => {
    const engaged = resolveAutoFollowAxis(0.86, 0.82, 2, 0.8, 0);
    const held = resolveAutoFollowAxis(0.74, 0.74, 2, 0.2, engaged.nextDirection);
    const released = resolveAutoFollowAxis(0.68, 0.68, 2, 0.2, held.nextDirection);

    expect(engaged.nextDirection).toBe(1);
    expect(held.nextDirection).toBe(1);
    expect(released.nextDirection).toBe(0);
  });
});
