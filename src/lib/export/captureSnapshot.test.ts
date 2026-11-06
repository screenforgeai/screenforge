import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME } from '../effects/frame';
import { DEFAULT_CAMERA_SETTINGS, DEFAULT_KEYBOARD_SETTINGS } from '../../store/defaults';
import { createCaptureStoreSnapshot } from './captureSnapshot';
import type { MotionClip } from '../animation/motionClips';

describe('createCaptureStoreSnapshot', () => {
  it('deep-clones export-visible editor state', () => {
    const state = {
      frame: {
        ...DEFAULT_FRAME,
        cropRect: { ...DEFAULT_FRAME.cropRect },
        background: {
          ...DEFAULT_FRAME.background,
          padding: 120,
        },
      },
      zoomClips: [
        {
          id: 'zoom-1',
          start: 0,
          end: 1.5,
          scale: 2.2,
          cx: 0.4,
          cy: 0.6,
          easeIn: 0.4,
          easeOut: 0.5,
          mode: 'auto' as const,
          preset: 'cinematic' as const,
          cinematicIntensity: 0.7,
          cinematicDepth: 0.8,
          cinematicFocus: 0.6,
          cinematicBackgroundFade: 0.7,
          cinematicTilt: 0.55,
          cinematicMotionBlur: 0.4,
          cinematicTiltMode: 'static' as const,
          cinematicTiltDirection: 'left' as const,
          easing: 'gentle' as const,
        },
      ],
      textClips: [],
      cameraClips: [],
      camera: {
        ...DEFAULT_CAMERA_SETTINGS,
        enabled: true,
        shadow: { ...DEFAULT_CAMERA_SETTINGS.shadow },
      },
      keyboard: {
        ...DEFAULT_KEYBOARD_SETTINGS,
        enabled: true,
      },
      cursorEnabled: true,
      cursorStyle: 'cursor01' as const,
      cursorSize: 125,
      cursorClickEffect: 'ripple' as const,
      cursorHalflife: 0.08,
      cursorMotionBlur: true,
      cursorMaxTilt: 4,
      cursorHideWhenIdle: false,
      cursorIdleHideSeconds: 5,
      maskClips: [],
      motionClips: [] as MotionClip[],
      zoomStyle: { intensity: 0.8, easing: 'gentle' as const },
    };

    const snapshot = createCaptureStoreSnapshot(state);

    snapshot.frame.cropRect.x = 0.25;
    snapshot.frame.background.padding = 40;
    snapshot.zoomClips[0].scale = 3.5;
    snapshot.zoomClips[0].preset = 'standard';
    snapshot.zoomClips[0].cinematicIntensity = 0.1;
    snapshot.zoomClips[0].cinematicDepth = 0.2;
    snapshot.zoomClips[0].cinematicFocus = 0.3;
    snapshot.zoomClips[0].cinematicBackgroundFade = 0.25;
    snapshot.zoomClips[0].cinematicTilt = 0.35;
    snapshot.zoomClips[0].cinematicMotionBlur = 0.9;
    (snapshot.zoomClips[0] as { cinematicTiltMode: unknown }).cinematicTiltMode = 'follow';
    snapshot.camera.shadow.blur = 99;
    snapshot.keyboard.enabled = false;

    expect(state.frame.cropRect.x).toBe(DEFAULT_FRAME.cropRect.x);
    expect(state.frame.background.padding).toBe(120);
    expect(state.zoomClips[0].scale).toBe(2.2);
    expect(state.zoomClips[0].preset).toBe('cinematic');
    expect(state.zoomClips[0].cinematicIntensity).toBe(0.7);
    expect(state.zoomClips[0].cinematicDepth).toBe(0.8);
    expect(state.zoomClips[0].cinematicFocus).toBe(0.6);
    expect(state.zoomClips[0].cinematicBackgroundFade).toBe(0.7);
    expect(state.zoomClips[0].cinematicTilt).toBe(0.55);
    expect(state.zoomClips[0].cinematicMotionBlur).toBe(0.4);
    expect(state.zoomClips[0].cinematicTiltMode).toBe('static');
    expect(state.camera.shadow.blur).toBe(DEFAULT_CAMERA_SETTINGS.shadow.blur);
    expect(state.keyboard.enabled).toBe(true);
  });

  it('carries the zoom style so the export worker can match the preview', () => {
    const snapshot = createCaptureStoreSnapshot({
      frame: DEFAULT_FRAME,
      zoomClips: [],
      textClips: [],
      cameraClips: [],
      camera: { ...DEFAULT_CAMERA_SETTINGS, shadow: { ...DEFAULT_CAMERA_SETTINGS.shadow } },
      keyboard: { ...DEFAULT_KEYBOARD_SETTINGS },
      cursorEnabled: true,
      cursorStyle: 'cursor01',
      cursorSize: 125,
      cursorClickEffect: 'none',
      cursorHalflife: 0.06,
      cursorMotionBlur: true,
      cursorMaxTilt: 4,
      cursorHideWhenIdle: false,
      cursorIdleHideSeconds: 5,
      maskClips: [],
      motionClips: [],
      zoomStyle: { intensity: 1.25, easing: 'snappy' },
    });

    expect(snapshot.zoomStyle).toEqual({ intensity: 1.25, easing: 'snappy' });
  });
});
