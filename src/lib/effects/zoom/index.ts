import { useStore } from '../../../store';
import type { ZoomClip } from '../../../types/timeline';
import type { CursorData } from '../cursor/index';
import { interpolateCursor } from '../cursor/render';
import type { Effect } from '../types';
import { detectZoomClips } from './analyze';
import { getZoomCrop, toCropSpacePoint, toCropSpaceRecording } from './crop-space';
import { resolveAutoFollowAxis, type FollowDirection } from './follow';
import { interpolateCamera } from './render';

export {
  ADD_ZOOM_FALLBACK_SCALE,
  ADD_ZOOM_MIN_CONFIDENCE,
  defaultCinematicZoomClip,
  defaultZoomClip,
  inferZoomDefaultsAtTime,
} from './analyze';
export {
  normalizeCinematicBackgroundFade,
  normalizeCinematicDepth,
  normalizeCinematicFocus,
  normalizeCinematicIntensity,
  normalizeCinematicMotionBlur,
  normalizeCinematicTilt,
  normalizeCinematicTiltDirection,
  normalizeCinematicTiltMode,
  normalizeZoomClip,
  normalizeZoomClips,
  normalizeZoomPreset,
} from './clip';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Critically-damped spring — exact closed-form solution, frame-rate independent.
 * Identical to the one in cursor/render.ts; duplicated to avoid coupling modules.
 */
function springDamp(
  pos: number,
  vel: number,
  target: number,
  halflife: number,
  dt: number,
): [number, number] {
  const y = 0.6931471805599453 / Math.max(halflife, 1e-5);
  const j0 = pos - target;
  const j1 = vel + j0 * y;
  const eydt = Math.exp(-y * dt);
  const newPos = eydt * (j0 + j1 * dt) + target;
  const newVel = eydt * (vel - j1 * y * dt);
  return [newPos, newVel];
}

function getCameraBounds(padding: number): { min: number; max: number } {
  const safePadding = clamp(padding, 0, 0.95);
  const contentSpan = Math.max(1 - safePadding, 0.05);
  const extension = safePadding / (2 * contentSpan);
  return { min: -extension, max: 1 + extension };
}

export interface SharedCameraState {
  cx: number;
  cy: number;
  scale: number;
  pivotX: number;
  pivotY: number;
  positionX: number;
  positionY: number;
  rotation: number;
  skewX: number;
  skewY: number;
}

/**
 * Written by the zoom frame wrapper every frame, read by the cursor overlay.
 * Single source of truth for camera geometry — eliminates independent-state
 * drift between the zoomed screen and crisp overlays.
 */
export const sharedCameraState: SharedCameraState = {
  cx: 0.5,
  cy: 0.5,
  scale: 1,
  pivotX: 0,
  pivotY: 0,
  positionX: 0,
  positionY: 0,
  rotation: 0,
  skewX: 0,
  skewY: 0,
};

export function setSharedCameraIdentity(cx = 0.5, cy = 0.5): void {
  sharedCameraState.cx = cx;
  sharedCameraState.cy = cy;
  sharedCameraState.scale = 1;
  sharedCameraState.pivotX = 0;
  sharedCameraState.pivotY = 0;
  sharedCameraState.positionX = 0;
  sharedCameraState.positionY = 0;
  sharedCameraState.rotation = 0;
  sharedCameraState.skewX = 0;
  sharedCameraState.skewY = 0;
}

export function setSharedCameraTransform(transform: SharedCameraState): void {
  sharedCameraState.cx = transform.cx;
  sharedCameraState.cy = transform.cy;
  sharedCameraState.scale = transform.scale;
  sharedCameraState.pivotX = transform.pivotX;
  sharedCameraState.pivotY = transform.pivotY;
  sharedCameraState.positionX = transform.positionX;
  sharedCameraState.positionY = transform.positionY;
  sharedCameraState.rotation = transform.rotation;
  sharedCameraState.skewX = transform.skewX;
  sharedCameraState.skewY = transform.skewY;
}

export function transformPointWithSharedCamera(x: number, y: number): { x: number; y: number } {
  const { scale, pivotX, pivotY, positionX, positionY, rotation, skewX, skewY } = sharedCameraState;
  const a = Math.cos(rotation + skewY) * scale;
  const b = Math.sin(rotation + skewY) * scale;
  const c = -Math.sin(rotation - skewX) * scale;
  const d = Math.cos(rotation - skewX) * scale;
  const tx = positionX - pivotX * a - pivotY * c;
  const ty = positionY - pivotX * b - pivotY * d;

  return {
    x: a * x + c * y + tx,
    y: b * x + d * y + ty,
  };
}

/**
 * Perspective warp state — written by the zoom effect each frame, read by the
 * cursor overlay. Mirrors the uniforms fed to CinematicZoomFilter's vertex
 * shader so the cursor can apply the same non-affine warp to its position.
 */
export interface SharedPerspectiveState {
  enabled: boolean;
  amount: number;
  focusX: number;
  focusY: number;
  aspect: number;
  canvasWidth: number;
  canvasHeight: number;
}

export const sharedPerspectiveState: SharedPerspectiveState = {
  enabled: false,
  amount: 0,
  focusX: 0.5,
  focusY: 0.5,
  aspect: 1,
  canvasWidth: 1,
  canvasHeight: 1,
};

export function setSharedPerspectiveState(state: SharedPerspectiveState): void {
  sharedPerspectiveState.enabled = state.enabled;
  sharedPerspectiveState.amount = state.amount;
  sharedPerspectiveState.focusX = state.focusX;
  sharedPerspectiveState.focusY = state.focusY;
  sharedPerspectiveState.aspect = state.aspect;
  sharedPerspectiveState.canvasWidth = state.canvasWidth;
  sharedPerspectiveState.canvasHeight = state.canvasHeight;
}

/**
 * Mirrors the vertex shader warp from CinematicZoomFilter (projectPlanePosition +
 * resolvePlaneUv). Takes a canvas-space pixel position that has already had the
 * affine camera transform applied, and returns the final screen position after
 * the perspective projection. Returns the input unchanged when the filter is off.
 *
 * farBlurPixels is omitted — it is always 0 in the current filter settings, so
 * the overscan term it produces is zero and can be skipped without loss of accuracy.
 */
export function applyPerspectiveWarpToPoint(cx: number, cy: number): { x: number; y: number } {
  const { enabled, amount, focusX, focusY, aspect, canvasWidth, canvasHeight } =
    sharedPerspectiveState;

  if (!enabled || amount <= 0.001) {
    return { x: cx, y: cy };
  }

  const safeWidth = Math.max(canvasWidth, 1);
  const safeHeight = Math.max(canvasHeight, 1);
  const safeAspect = Math.max(aspect, 0.001);
  const safeAmount = Math.min(Math.max(amount, 0), 0.5);

  const u = cx / safeWidth;
  const v = cy / safeHeight;

  // resolvePlaneOverscan — farBlurPixels always 0, so blurOverscan = 0
  const overscan = Math.min(safeAmount * 0.4, 0.26);

  // resolvePlaneUv: mix(-overscan, 1+overscan, aPosition)
  const uvX = -overscan + (1 + 2 * overscan) * u;
  const uvY = -overscan + (1 + 2 * overscan) * v;

  // projectPlanePosition
  const focusOriginX = Math.min(Math.max(focusX, 0.02), 0.98);
  const focusOriginY = Math.min(Math.max(focusY, 0.02), 0.98);

  // dir = normalize(toAspect(focusDirection - 0.5))
  const dirAspectX = (focusOriginX - 0.5) * safeAspect;
  const dirAspectY = focusOriginY - 0.5;
  const dirLength = Math.sqrt(dirAspectX * dirAspectX + dirAspectY * dirAspectY);

  if (dirLength <= 0.001) {
    return { x: cx, y: cy };
  }

  const dirX = dirAspectX / dirLength;
  const dirY = dirAspectY / dirLength;

  // along = dot(toAspect(uv - focusOrigin), dir)
  const along = (uvX - focusOriginX) * safeAspect * dirX + (uvY - focusOriginY) * dirY;

  // safeMaxZ prevents perspective-induced gaps near canvas edges
  const safeMaxZ = Math.min(
    Math.min(
      (1 + overscan - focusOriginX) / Math.max(1 - focusOriginX, 0.001),
      (focusOriginX + overscan) / Math.max(focusOriginX, 0.001),
    ),
    Math.min(
      (1 + overscan - focusOriginY) / Math.max(1 - focusOriginY, 0.001),
      (focusOriginY + overscan) / Math.max(focusOriginY, 0.001),
    ),
  );

  const z = Math.min(Math.max(1.0 - along * safeAmount * 0.8, 0.65), safeMaxZ);

  const projectedUvX = focusOriginX + (uvX - focusOriginX) / z;
  const projectedUvY = focusOriginY + (uvY - focusOriginY) / z;

  // projectedUv maps to screen pixels: screenPixel = projectedUv * filterAreaSize
  // (filter area = full canvas, so filterAreaSize = canvasSize)
  return {
    x: projectedUvX * safeWidth,
    y: projectedUvY * safeHeight,
  };
}

// Camera spring halflife — intentionally larger than cursorHalflife so the
// camera moves lazily and doesn't amplify every small cursor wiggle.
const CAM_HALFLIFE = 0.12;
const CAMERA_FOLLOW_START_SCALE = 1.32;
const CAMERA_FOLLOW_FULL_SCALE = 1.9;

function smootherStep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * c * (c * (c * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function resolveCameraFollowBlend(scale: number): number {
  return smootherStep(
    (scale - CAMERA_FOLLOW_START_SCALE) / (CAMERA_FOLLOW_FULL_SCALE - CAMERA_FOLLOW_START_SCALE),
  );
}

function clampSpringToBounds(pos: number, vel: number, min: number, max: number): [number, number] {
  if (pos < min) {
    return [min, vel < 0 ? 0 : vel];
  }

  if (pos > max) {
    return [max, vel > 0 ? 0 : vel];
  }

  return [pos, vel];
}

export const zoomEffect: Effect<ZoomClip[]> = {
  id: 'zoom',

  // Auto zoom targets are positions in the cropped picture, like manual ones.
  analyze: (recording) =>
    detectZoomClips(toCropSpaceRecording(recording, getZoomCrop(useStore.getState()))),

  onLoad(data) {
    const { zoomClips, setZoom } = useStore.getState();
    if (zoomClips.length === 0) {
      setZoom(data);
    }
  },

  createFrameWrapper(_data, allData) {
    const cursorData = allData.get('cursor') as CursorData | undefined;

    // Spring state lives in the closure — resets when createFrameWrapper is re-called (new recording)
    let camCx = 0.5;
    let camCy = 0.5;
    let camVelCx = 0;
    let camVelCy = 0;
    let followXDirection: FollowDirection = 0;
    let followYDirection: FollowDirection = 0;

    // Spring-smoothed cursor position used exclusively for dead-zone calculations.
    //
    // The dead-zone logic reacts to the cursor's screen position. If it uses the raw
    // (CR-interpolated) cursor position, any fast-movement oscillation in the mouse
    // events (100–140 px every other frame) drives the camera spring, which shifts
    // the zoom pivot and moves the rendered cursor ~22 px in the WRONG direction —
    // the visible "up-down" stutter even though the cursor spring itself is smooth.
    //
    // Using a spring-smoothed cursor (same halflife as the cursor overlay) means the
    // dead-zone only reacts to sustained cursor movement, not single-frame spikes.
    let dzCursorNx = 0.5;
    let dzCursorNy = 0.5;
    let dzCursorVelNx = 0;
    let dzCursorVelNy = 0;

    return (ctx, next, t, dt, _sourceWidth, _sourceHeight, canvasWidth, canvasHeight) => {
      const state = useStore.getState();

      if (state.hiddenLayers.zoom) {
        setSharedCameraIdentity();
        next();
        return;
      }

      const clips = state.zoomClips;
      const { padding } = state.frame.background;
      const { cursorHalflife, cursorContinuousTracking } = state;
      const bounds = getCameraBounds(padding);
      // The camera centres on positions in the cropped picture; the cursor's
      // are across the whole recording.
      const cursorPos = cursorData ? interpolateCursor(cursorData.moveEvents, t) : null;
      const pos = cursorPos ? toCropSpacePoint(cursorPos, getZoomCrop(state)) : null;
      const target = interpolateCamera(clips, t, pos ?? undefined);

      if (!target) {
        // Not in a zoom clip — snap so camera is primed for the next one
        if (pos) {
          camCx = clamp(pos.nx, bounds.min, bounds.max);
          camCy = clamp(pos.ny, bounds.min, bounds.max);
          camVelCx = 0;
          camVelCy = 0;
          // Snap dead-zone cursor too so it's ready when a zoom clip starts
          dzCursorNx = pos.nx;
          dzCursorNy = pos.ny;
          dzCursorVelNx = 0;
          dzCursorVelNy = 0;
        }
        followXDirection = 0;
        followYDirection = 0;
        setSharedCameraIdentity(camCx, camCy);
        next();
        return;
      }

      const scale = target.scale;

      // Advance the dead-zone cursor spring toward the raw cursor position.
      // Apply the same two velocity clamps used by the cursor overlay to
      // guarantee no overshoot — raw cursor oscillations cannot sneak through.
      if (pos && dt > 0) {
        const hl = Math.max(cursorHalflife, 1e-5);
        const yDz = 0.6931471805599453 / hl;
        const exDz = dzCursorNx - pos.nx;
        const eyDz = dzCursorNy - pos.ny;
        // Critical-velocity clamp: prevent within-step overshoot
        if (exDz > 0 && dzCursorVelNx < -exDz * yDz) {
          dzCursorVelNx = -exDz * yDz;
        }
        if (exDz < 0 && dzCursorVelNx > -exDz * yDz) {
          dzCursorVelNx = -exDz * yDz;
        }
        if (eyDz > 0 && dzCursorVelNy < -eyDz * yDz) {
          dzCursorVelNy = -eyDz * yDz;
        }
        if (eyDz < 0 && dzCursorVelNy > -eyDz * yDz) {
          dzCursorVelNy = -eyDz * yDz;
        }
        // Already-crossed clamp: zero velocity if spring past target moving further away
        if ((exDz < 0 && dzCursorVelNx < 0) || (exDz > 0 && dzCursorVelNx > 0)) {
          dzCursorVelNx = 0;
        }
        if ((eyDz < 0 && dzCursorVelNy < 0) || (eyDz > 0 && dzCursorVelNy > 0)) {
          dzCursorVelNy = 0;
        }
        [dzCursorNx, dzCursorVelNx] = springDamp(dzCursorNx, dzCursorVelNx, pos.nx, hl, dt);
        [dzCursorNy, dzCursorVelNy] = springDamp(dzCursorNy, dzCursorVelNy, pos.ny, hl, dt);
      }

      // Dead-zone camera: only chase the cursor when it exits the central region
      // of the screen. While inside the zone, lazyCx/lazyCy stay at the current
      // camera position so the spring has zero error and the frame is still.
      //
      // Uses the smoothed dead-zone cursor (not raw pos) so that single-frame
      // oscillations in the recorded mouse events don't drive the camera spring.
      //
      // Forward formula (from zoom/render.ts): screen_x = scale * content_x + cx * (1 - scale)
      // Inverse (solve for cx that places cursor at screen position sx):
      //   cx = (scale * pos - sx) / (scale - 1)
      let lazyCx = target.cx;
      let lazyCy = target.cy;

      if (target.mode === 'auto' && pos && scale > 1.001) {
        if (cursorContinuousTracking) {
          lazyCx = camCx;
          lazyCy = camCy;
          const followBlend = resolveCameraFollowBlend(scale);
          if (followBlend <= 0.001) {
            followXDirection = 0;
            followYDirection = 0;
          } else {
            const cursorScreenX = scale * dzCursorNx + camCx * (1 - scale);
            const cursorScreenY = scale * dzCursorNy + camCy * (1 - scale);
            const axisX = resolveAutoFollowAxis(
              cursorScreenX,
              dzCursorNx,
              scale,
              dzCursorVelNx,
              followXDirection,
            );
            const axisY = resolveAutoFollowAxis(
              cursorScreenY,
              dzCursorNy,
              scale,
              dzCursorVelNy,
              followYDirection,
            );

            followXDirection = axisX.nextDirection;
            followYDirection = axisY.nextDirection;
            if (axisX.target !== null) {
              lazyCx = lerp(camCx, axisX.target, followBlend);
            }
            if (axisY.target !== null) {
              lazyCy = lerp(camCy, axisY.target, followBlend);
            }
          }
        } else {
          // Fixed mode: camera stays put, only repositions when cursor exits visible frame
          followXDirection = 0;
          followYDirection = 0;
          lazyCx = camCx;
          lazyCy = camCy;
          const SNAP_MARGIN = 0.05;
          const screenX = scale * dzCursorNx + camCx * (1 - scale);
          const screenY = scale * dzCursorNy + camCy * (1 - scale);
          const followBlend = resolveCameraFollowBlend(scale);
          if (screenX < SNAP_MARGIN) {
            lazyCx = lerp(camCx, (scale * dzCursorNx - SNAP_MARGIN) / (scale - 1), followBlend);
          } else if (screenX > 1 - SNAP_MARGIN) {
            lazyCx = lerp(
              camCx,
              (scale * dzCursorNx - (1 - SNAP_MARGIN)) / (scale - 1),
              followBlend,
            );
          }
          if (screenY < SNAP_MARGIN) {
            lazyCy = lerp(camCy, (scale * dzCursorNy - SNAP_MARGIN) / (scale - 1), followBlend);
          } else if (screenY > 1 - SNAP_MARGIN) {
            lazyCy = lerp(
              camCy,
              (scale * dzCursorNy - (1 - SNAP_MARGIN)) / (scale - 1),
              followBlend,
            );
          }
        }
      } else {
        followXDirection = 0;
        followYDirection = 0;
      }

      const targetCx = clamp(lazyCx, bounds.min, bounds.max);
      const targetCy = clamp(lazyCy, bounds.min, bounds.max);

      [camCx, camVelCx] = springDamp(camCx, camVelCx, targetCx, CAM_HALFLIFE, dt);
      [camCy, camVelCy] = springDamp(camCy, camVelCy, targetCy, CAM_HALFLIFE, dt);

      // Clamp to frame-padding-extended camera bounds.
      [camCx, camVelCx] = clampSpringToBounds(camCx, camVelCx, bounds.min, bounds.max);
      [camCy, camVelCy] = clampSpringToBounds(camCy, camVelCy, bounds.min, bounds.max);

      // Publish for cursor overlay — must happen before next() so overlay reads
      // this frame's value (zoom wrapper runs before overlay in the RAF chain).
      const pivotX = (padding / 2 + camCx * (1 - padding)) * canvasWidth;
      const pivotY = (padding / 2 + camCy * (1 - padding)) * canvasHeight;
      setSharedCameraTransform({
        cx: camCx,
        cy: camCy,
        scale: target.scale,
        pivotX: 0,
        pivotY: 0,
        positionX: pivotX * (1 - target.scale),
        positionY: pivotY * (1 - target.scale),
        rotation: 0,
        skewX: 0,
        skewY: 0,
      });

      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.scale(target.scale, target.scale);
      ctx.translate(-pivotX, -pivotY);

      next();

      ctx.restore();
    };
  },
};
