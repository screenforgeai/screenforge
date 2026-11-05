import type { PixiEffect } from '../../pixi/types';
import type { RenderContext } from '../types';
import { useStore } from '../../../store';
import { isIdentityMotion } from '../../animation/sceneMotion';
import { resolveMotionAt } from '../../animation/motionClips';
import { SceneTiltFilter } from '../../pixi/filters/SceneTiltFilter';

/** Perspective camera distance as a multiple of the canvas' longer side. */
const CAMERA_DISTANCE_FACTOR = 1.8;
const MIN_TILT_DEG = 0.01;

/**
 * Scene motion: the motion clips' scale, offset, rotation, 3D tilt and opacity of
 * scene.motionContainer — the recording plus its cursor and masks. Values are
 * a pure function of timeline time, so preview scrubbing and export match.
 */
export const motionPixiEffect: PixiEffect<null> = {
  id: 'motion',

  analyze: () => null,

  setup(_data, _allData, scene) {
    const container = scene.motionContainer;
    const tiltFilter = new SceneTiltFilter();
    tiltFilter.enabled = false;
    container.filters = [tiltFilter];

    return (t: number, _dt: number, renderContext: RenderContext) => {
      const { motionClips, currentTime, hiddenLayers, mediaSegments } = useStore.getState();
      const isPreviewMode = renderContext.videoSource?.source instanceof HTMLVideoElement;
      const timelineT = isPreviewMode ? currentTime : (renderContext.outputTime ?? t);
      const values = resolveMotionAt(motionClips, mediaSegments, timelineT);

      // The timeline's eye toggle on the Motion lane turns the motion off.
      if (hiddenLayers.motion || isIdentityMotion(values)) {
        container.pivot.set(0, 0);
        container.position.set(0, 0);
        container.scale.set(1);
        container.angle = 0;
        container.alpha = 1;
        tiltFilter.enabled = false;
        return;
      }

      // Stage coordinates: export may offset the stage to centre the content area.
      const cw = scene.app.renderer.width - 2 * scene.app.stage.x;
      const ch = scene.app.renderer.height - 2 * scene.app.stage.y;

      container.pivot.set(cw / 2, ch / 2);
      container.position.set(cw / 2 + values.x * cw, ch / 2 + values.y * ch);
      container.scale.set(values.scale);
      container.angle = values.rotation;
      container.alpha = values.opacity;

      const tilted = Math.abs(values.tiltX) > MIN_TILT_DEG || Math.abs(values.tiltY) > MIN_TILT_DEG;
      tiltFilter.enabled = tilted;
      if (tilted) {
        const distance = Math.max(cw, ch) * values.scale * CAMERA_DISTANCE_FACTOR;
        tiltFilter.setTilt(values.tiltX, values.tiltY, distance);
      }
    };
  },
};
