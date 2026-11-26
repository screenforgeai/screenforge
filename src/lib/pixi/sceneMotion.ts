import type { Container } from 'pixi.js';
import type { PixiScene } from './types';

/**
 * Smallest change that still counts as movement. The camera works in units of
 * the canvas (0..1) and canvas pixels; 1e-4 is well under a pixel either way.
 */
export const SCENE_MOTION_EPSILON = 1e-4;

const pushTransform = (out: number[], c: Container): void => {
  out.push(
    c.position.x,
    c.position.y,
    c.scale.x,
    c.scale.y,
    c.pivot.x,
    c.pivot.y,
    c.rotation,
    c.skew.x,
    c.skew.y,
    c.alpha,
  );
};

/**
 * The transforms that effects animate on their own between edits: the zoom
 * camera's follow and tilt, motion clips, the fade-in of a clip after the first
 * (timed by the wall clock, up to 1.5 s, on the video container), and what rides
 * on them (the cursor). The paused preview keeps drawing while these still change
 * frame to frame: the camera's follow is stateful and keeps easing for a while
 * after a seek.
 */
export function readSceneMotion(scene: PixiScene): number[] {
  const out: number[] = [];
  pushTransform(out, scene.motionContainer);
  pushTransform(out, scene.compositeContainer);
  pushTransform(out, scene.cameraContainer);
  pushTransform(out, scene.frameContainer);
  pushTransform(out, scene.videoContainer);
  for (const child of scene.motionOverlayContainer.children) {
    pushTransform(out, child);
  }
  return out;
}

/** Whether anything moved by more than `epsilon` between two readings. */
export function hasSceneMoved(
  previous: readonly number[] | null,
  next: readonly number[],
  epsilon: number = SCENE_MOTION_EPSILON,
): boolean {
  if (!previous || previous.length !== next.length) {
    return true;
  }
  for (let i = 0; i < next.length; i++) {
    if (Math.abs(next[i] - previous[i]) > epsilon) {
      return true;
    }
  }
  return false;
}
