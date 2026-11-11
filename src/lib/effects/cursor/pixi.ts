/**
 * Cursor effect — PixiJS implementation.
 *
 * Renders the cursor overlay using PixiJS Sprites (GPU texture sampling)
 * instead of Canvas 2D drawImage(). All spring-physics and state-machine
 * logic is copied verbatim from the Canvas 2D version.
 *
 * Lives in scene.motionOverlayContainer — NOT inside cameraContainer, so it is
 * not subject to the zoom Container transform (but does follow scene motion). Canvas-space position is
 * computed manually using the same pivot math as the zoom effect so the
 * cursor sits correctly within the zoomed frame.
 */
import { Container, Sprite, Graphics, Assets, Texture, Matrix } from 'pixi.js';
import type { PixiEffect, PixiEffectUpdater } from '../../pixi/types';
import { RECORDING_VIDEO_SPRITE_LABEL } from '../../pixi/types';
import { useStore } from '../../../store';
import { getFrameGeometry, getFrameGeometryForPanel } from '../frame/analyze';
import { getClipTransitionAlpha } from '../frame/index';
import { interpolateCamera } from '../zoom/render';
import { resolveCameraAtTime } from '../camera/layout';
import { transformPointWithSharedCamera, applyPerspectiveWarpToPoint } from '../zoom/index';
import { interpolateCursor } from './render';
import { getMoveEvents, getClickEvents, getPressEvents, getActivityEvents } from './analyze';
import type { CursorData, PressEvent, ActivityEvent } from './analyze';
import { resolveCursorStyleState, isCursorStyleStateType, type CursorStyleState } from './cursors';
import {
  cursorStyleReactsToPress,
  isAnimatedCursorStyle,
  isNameTagCursorStyle,
  normalizeCursorStyle,
  renderCursorStyleToCanvas,
  type CursorStyleId,
  type VectorCursorStyleId,
} from './styles';
import {
  MAGNIFIER_RADIUS,
  MAGNIFIER_ZOOM,
  MAX_CLICK_EFFECT_DURATION,
  PRESS_SCALE,
  SHRINK_PRESS_SCALE,
  drawCursorEffects,
  findClicksInWindow,
  needsEffectsOverlay,
} from './effects';
import type { ZoomClip } from '../../../types/timeline';
import { mapSourceTimeToTimelineTime, findSegmentAtSourceTime } from '../../helpers/segments';
import cursorDefault01Url from '../../../assets/cursors/cursor-default-01.svg';
import cursorPointer01Url from '../../../assets/cursors/cursor-pointer-01.svg';
import cursorText01Url from '../../../assets/cursors/cursor-text-01.svg';

// ── Constants (mirrors cursors.tsx) ──────────────────────────────────────────

const CURSOR_ASSET_SIZE = 32;
const CURSOR_DRAW_SIZE = 52;

// ── Timing constants (mirrors render.ts) ─────────────────────────────────────

const RIPPLE_DURATION = 0.45;
const STYLE_CROSSFADE_DURATION = 0.12;
const STYLE_SWITCH_HOLD_DURATION = 0.075;
const STYLE_SWITCH_TO_DEFAULT_HOLD_DURATION = 0.14;
const CLICK_PRESS_DURATION = 0.15;

// ── Motion blur constants ─────────────────────────────────────────────────────

const MOTION_BLUR_STEPS = 6;
const SPEED_THRESHOLD = 100; // canvas px/s — no blur below this
const DISP_VEL_ALPHA = 0.15;
const SMOOTH_ALPHA = 0.8;

// ── Max simultaneous ripple rings in the Graphics pool ────────────────────────

const MAX_RIPPLES = 4;

// ── Hotspot positions (CURSOR_ASSET_SIZE-space) ───────────────────────────────

const HOTSPOTS: Record<CursorStyleState, { x: number; y: number }> = {
  default: { x: 10, y: 2 },
  pointer: { x: 10, y: 2 },
  text: { x: 13, y: 13 },
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

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
  return [eydt * (j0 + j1 * dt) + target, eydt * (vel - j1 * y * dt)];
}

function isPressedAtTime(pressEvents: PressEvent[], t: number): boolean {
  if (pressEvents.length === 0) {
    return false;
  }
  let lo = 0;
  let hi = pressEvents.length - 1;
  let prev = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pressEvents[mid].t <= t) {
      prev = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return prev >= 0 ? pressEvents[prev].isDown : false;
}

function findLastEventTime(events: ActivityEvent[], t: number): number | null {
  if (events.length === 0) {
    return null;
  }
  let lo = 0;
  let hi = events.length - 1;
  let prev = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].t <= t) {
      prev = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return prev >= 0 ? events[prev].t : null;
}

// ── Sprite helpers ────────────────────────────────────────────────────────────

/** A cursor texture plus where its hotspot is and how big one draw unit is in it. */
interface CursorTexture {
  texture: Texture;
  anchorX: number;
  anchorY: number;
  /** Draw units per texture pixel. */
  unitsPerPixel: number;
}

function svgCursorTexture(texture: Texture, state: CursorStyleState): CursorTexture {
  const h = HOTSPOTS[state];
  return {
    texture,
    anchorX: h.x / CURSOR_ASSET_SIZE,
    anchorY: h.y / CURSOR_ASSET_SIZE,
    // The SVG renders at CURSOR_DRAW_SIZE draw units across its width.
    unitsPerPixel: CURSOR_DRAW_SIZE / Math.max(texture.width, 1),
  };
}

// Pixels per draw unit for vector cursor textures: sharp up to 4K at large sizes.
const VECTOR_CURSOR_RESOLUTION = 6;
// Redraw twinkling cursors at most this often (seconds).
const ANIMATED_CURSOR_FRAME = 1 / 60;

interface VectorSlot {
  key: string;
  canvas: HTMLCanvasElement;
  cursor: CursorTexture;
  drawnAt: number;
}

/**
 * Canvas-backed textures for the vector styles. One slot per style state keeps
 * memory flat while a name tag is typed: a new key replaces the old
 * texture instead of piling up. Twinkling styles redraw their canvas in place.
 */
function createVectorCursorTextures() {
  const slots = new Map<string, VectorSlot>();
  return (
    style: VectorCursorStyleId,
    state: CursorStyleState,
    pressed: boolean,
    color: string,
    label: string,
    t: number,
  ): CursorTexture => {
    const isPressed = pressed && cursorStyleReactsToPress(style);
    const slotId = `${style}|${state}|${isPressed ? 1 : 0}`;
    const key = isNameTagCursorStyle(style) ? `${slotId}|${color}|${label}` : slotId;
    const animated = isAnimatedCursorStyle(style);
    let slot = slots.get(slotId);
    if (!slot || slot.key !== key) {
      slot?.cursor.texture.destroy(true);
      const canvas = document.createElement('canvas');
      const info = renderCursorStyleToCanvas(
        canvas,
        style,
        state,
        { time: t, color, label, pressed: isPressed },
        VECTOR_CURSOR_RESOLUTION,
      );
      slot = {
        key,
        canvas,
        drawnAt: t,
        cursor: {
          texture: Texture.from(canvas),
          anchorX: info.anchorX,
          anchorY: info.anchorY,
          unitsPerPixel: 1 / VECTOR_CURSOR_RESOLUTION,
        },
      };
      slots.set(slotId, slot);
    } else if (animated && Math.abs(t - slot.drawnAt) >= ANIMATED_CURSOR_FRAME) {
      renderCursorStyleToCanvas(
        slot.canvas,
        style,
        state,
        { time: t, color, label, pressed: isPressed },
        VECTOR_CURSOR_RESOLUTION,
      );
      slot.drawnAt = t;
      slot.cursor.texture.source.update();
    }
    return slot.cursor;
  };
}

/**
 * Positions, orients, and sizes a cursor sprite so that its hotspot sits at
 * (cx, cy) in canvas space at the given total scale factor.
 */
function positionCursorSprite(
  sprite: Sprite,
  cursor: CursorTexture,
  cx: number,
  cy: number,
  totalScale: number,
  rotation: number,
): void {
  sprite.texture = cursor.texture;
  sprite.anchor.set(cursor.anchorX, cursor.anchorY);
  sprite.x = cx;
  sprite.y = cy;
  sprite.rotation = rotation;
  // One draw unit renders as totalScale canvas px.
  sprite.scale.set(cursor.unitsPerPixel * totalScale);
}

// ── Cursor effect ─────────────────────────────────────────────────────────────

export const cursorPixiEffect: PixiEffect<CursorData> = {
  id: 'cursor',

  analyze(recording) {
    if (!recording.recordingArea || !recording.startTime) {
      return {
        moveEvents: [],
        clickEvents: [],
        pressEvents: [],
        activityEvents: [],
      };
    }
    return {
      moveEvents: getMoveEvents(
        recording.mouseData,
        recording.startTime,
        recording.recordingArea,
        recording.captureBoundsTimeline,
      ),
      clickEvents: getClickEvents(
        recording.mouseData,
        recording.startTime,
        recording.recordingArea,
        recording.captureBoundsTimeline,
      ),
      pressEvents: getPressEvents(recording.mouseData, recording.startTime),
      activityEvents: getActivityEvents(recording.mouseData, recording.startTime),
    };
  },

  async setup(data, _allData, scene): Promise<PixiEffectUpdater> {
    const { moveEvents, clickEvents, pressEvents, activityEvents } = data;

    // ── Load cursor SVG textures ─────────────────────────────────────────────
    const [texDefault, texPointer, texText] = await Promise.all([
      Assets.load<Texture>(cursorDefault01Url),
      Assets.load<Texture>(cursorPointer01Url),
      Assets.load<Texture>(cursorText01Url),
    ]);

    const svgTextures: Record<CursorStyleState, CursorTexture> = {
      default: svgCursorTexture(texDefault, 'default'),
      pointer: svgCursorTexture(texPointer, 'pointer'),
      text: svgCursorTexture(texText, 'text'),
    };
    const vectorTextures = createVectorCursorTextures();

    // ── Effects layer (spotlight, highlight, glitter, pulse, sparkles, confetti) ──
    // One canvas the size of the output, drawn with the same code as the editor's
    // previews and uploaded only on frames that use an effect.
    const effectsCanvas = document.createElement('canvas');
    effectsCanvas.width = 1;
    effectsCanvas.height = 1;
    const effectsCtx = effectsCanvas.getContext('2d');
    const effectsSprite = new Sprite(Texture.from(effectsCanvas));
    effectsSprite.eventMode = 'none';
    effectsSprite.visible = false;

    // ── Magnifier: the recording again, zoomed, inside a circle ──────────────
    const lensSprite = new Sprite();
    lensSprite.eventMode = 'none';
    const lensMask = new Graphics();
    lensMask.eventMode = 'none';
    lensSprite.mask = lensMask;
    const lensRing = new Graphics();
    lensRing.eventMode = 'none';
    const lens = new Container();
    lens.eventMode = 'none';
    lens.visible = false;
    lens.addChild(lensSprite, lensMask, lensRing);
    const lensMatrix = new Matrix();
    const overlayMatrix = new Matrix();
    let recordingSprite: Sprite | null = null;

    // ── Display objects ──────────────────────────────────────────────────────
    // Motion blur: 6 ghost sprites drawn behind the main cursor.
    const ghostSprites = Array.from({ length: MOTION_BLUR_STEPS }, () => {
      const s = new Sprite();
      s.eventMode = 'none';
      s.visible = false;
      return s;
    });

    // Crossfade: outgoing state fades out, incoming fades in.
    const prevSprite = new Sprite();
    prevSprite.eventMode = 'none';
    prevSprite.visible = false;

    const mainSprite = new Sprite();
    mainSprite.eventMode = 'none';
    mainSprite.visible = false;

    // Ripple rings — one Graphics per simultaneous ripple.
    const ripplePool = Array.from({ length: MAX_RIPPLES }, () => {
      const g = new Graphics();
      g.eventMode = 'none';
      return g;
    });

    const cursorContainer = new Container();
    cursorContainer.eventMode = 'none';
    // Draw order: effects → magnifier → ghosts → ripples → prevSprite → mainSprite
    cursorContainer.addChild(
      effectsSprite,
      lens,
      ...ghostSprites,
      ...ripplePool,
      prevSprite,
      mainSprite,
    );
    scene.motionOverlayContainer.addChild(cursorContainer);

    // ── Spring-physics closure state ─────────────────────────────────────────
    // Position spring (normalised 0–1).
    let posNx = 0;
    let posNy = 0;
    let velNx = 0;
    let velNy = 0;
    // EMA-smoothed display velocity for motion blur / tilt (decoupled from physics vel).
    let dispVelNx = 0;
    let dispVelNy = 0;
    // Pre-filter on raw cursor to suppress single-frame ScreenCaptureKit spikes.
    let smoothTargetNx = 0;
    let smoothTargetNy = 0;
    // Click-scale spring.
    let clickScalePos = 1;
    let clickScaleVel = 0;
    // Rotation spring (smoothed to prevent ±π wrap jerk).
    let smoothedRotation = 0;
    let rotVel = 0;

    // ── Style-state machine ──────────────────────────────────────────────────
    let activeStyleState: CursorStyleState = 'default';
    let previousStyleState: CursorStyleState | null = null;
    let styleStateTransitionStartedAt = 0;
    let pendingStyleState: CursorStyleState | null = null;
    let pendingStyleStateSince = 0;

    // ── Frame tracking ───────────────────────────────────────────────────────
    type Ripple = { nx: number; ny: number; createdAt: number };
    let ripples: Ripple[] = [];
    let lastT = -1;
    let initialized = false;

    // ── Updater ──────────────────────────────────────────────────────────────
    return (t, dtArg) => {
      const {
        cursorEnabled,
        cursorStyle,
        cursorEffect,
        cursorClickShrink,
        cursorColor,
        cursorLabel,
        cursorSize,
        cursorClickEffect,
        cursorHalflife,
        cursorMotionBlur,
        cursorMaxTilt,
        cursorHideWhenIdle,
        cursorIdleHideSeconds,
        isCropEditing,
        frame,
        zoomClips,
        mediaSegments,
        camera,
        cameraClips,
      } = useStore.getState();

      if (isCropEditing || !cursorEnabled) {
        cursorContainer.visible = false;
        return;
      }

      const activeSegment = findSegmentAtSourceTime(mediaSegments, t);
      if (activeSegment?.cursorEnabled === false) {
        cursorContainer.visible = false;
        return;
      }
      cursorContainer.visible = true;
      cursorContainer.alpha = getClipTransitionAlpha();

      const dt = Math.max(0, Math.min(dtArg, 0.05));

      // Detect seek/scrub — snap spring state instead of interpolating.
      const prevT = lastT;
      const isSeek = prevT >= 0 && Math.abs(t - prevT) > Math.max(0.1, dt * 3);
      lastT = t;

      const cw = scene.app.renderer.width;
      const ch = scene.app.renderer.height;

      // Geometry — panel-adjusted when camera is in a side layout so cursor
      // positions map to the recording panel rather than the full canvas.
      const clipT = mapSourceTimeToTimelineTime(mediaSegments, t) ?? t;
      const zoomScaleForGeom = interpolateCamera(zoomClips as ZoomClip[], clipT)?.scale ?? 1;
      let geometry = getFrameGeometry(frame, scene.sourceWidth, scene.sourceHeight);
      if (camera.enabled) {
        const cameraResolved = resolveCameraAtTime(
          cameraClips,
          clipT,
          camera,
          cw,
          ch,
          zoomScaleForGeom,
        );
        const sr = cameraResolved?.screenRect ?? null;
        if (sr !== null) {
          geometry = getFrameGeometryForPanel(
            frame,
            scene.sourceWidth,
            scene.sourceHeight,
            sr.x,
            sr.y,
            sr.width,
            sr.height,
            camera.fixedPadding * (Math.min(cw, ch) / 1080),
          );
        }
      }
      const cropWidth = Math.max(geometry.cropRectPixels.width, 1);
      const cropHeight = Math.max(geometry.cropRectPixels.height, 1);
      const frameScaleX = geometry.mediaRect.width / cropWidth;
      const frameScaleY = geometry.mediaRect.height / cropHeight;
      const frameScale = (frameScaleX + frameScaleY) / 2;

      /** Converts normalised cursor (0–1) → frame-space canvas coordinates. */
      const toFramePoint = (nx: number, ny: number) => ({
        x:
          geometry.mediaRect.x + (nx * scene.sourceWidth - geometry.cropRectPixels.x) * frameScaleX,
        y:
          geometry.mediaRect.y +
          (ny * scene.sourceHeight - geometry.cropRectPixels.y) * frameScaleY,
      });

      // Gather click ripples that fired since the last frame.
      for (const click of clickEvents) {
        if (click.t > (isSeek ? t - 0.001 : prevT) && click.t <= t) {
          ripples.push({ nx: click.nx, ny: click.ny, createdAt: click.t });
        }
      }
      ripples = ripples.filter((r) => {
        const progress = (t - r.createdAt) / RIPPLE_DURATION;
        return progress >= 0 && progress <= 1;
      });

      const pos = interpolateCursor(moveEvents, t);
      if (!pos) {
        cursorContainer.visible = false;
        return;
      }

      const lastActivityTime = findLastEventTime(activityEvents, t);
      const isVisible =
        !cursorHideWhenIdle ||
        (lastActivityTime !== null && t - lastActivityTime <= cursorIdleHideSeconds);

      // ── Cursor diagnostics: sample near each segment boundary ──────────
      if (mediaSegments.length > 1 && Math.round(t * 60) % 5 === 0) {
        const nearestBoundary = mediaSegments.reduce(
          (best, seg) => {
            const d = Math.abs(t - seg.sourceEnd);
            return d < best.dist ? { dist: d, end: seg.sourceEnd } : best;
          },
          { dist: Infinity, end: 0 },
        );
      }
      const cameraTarget = interpolateCamera(zoomClips as ZoomClip[], clipT, pos);
      const zoomScale = cameraTarget?.scale ?? 1;
      const baseScale = (ch / 1080) * (cursorSize / 100) * frameScale * zoomScale;

      /**
       * Converts normalised cursor → canvas-space with zoom/tilt and perspective warp applied.
       * The affine transform accounts for zoom scale and tilt rotation/skew; the perspective
       * warp mirrors the CinematicZoomFilter vertex shader so the cursor tracks the visual
       * position of content after the 3D plane projection.
       */
      const toCanvasPoint = (nx: number, ny: number) => {
        const fp = toFramePoint(nx, ny);
        const affine = transformPointWithSharedCamera(fp.x, fp.y);
        return applyPerspectiveWarpToPoint(affine.x, affine.y);
      };

      // ── Style-state machine ────────────────────────────────────────────────
      const isStyleStateCursor = isCursorStyleStateType(pos.cursorType);
      if (isStyleStateCursor) {
        const targetStyleState = resolveCursorStyleState(pos.cursorType);
        if (targetStyleState === activeStyleState) {
          pendingStyleState = null;
          pendingStyleStateSince = 0;
        } else {
          if (pendingStyleState !== targetStyleState) {
            pendingStyleState = targetStyleState;
            pendingStyleStateSince = t;
          } else {
            const holdDuration =
              targetStyleState === 'default'
                ? STYLE_SWITCH_TO_DEFAULT_HOLD_DURATION
                : STYLE_SWITCH_HOLD_DURATION;
            if (t - pendingStyleStateSince >= holdDuration) {
              previousStyleState = activeStyleState;
              activeStyleState = targetStyleState;
              styleStateTransitionStartedAt = t;
              pendingStyleState = null;
              pendingStyleStateSince = 0;
            }
          }
        }
      } else {
        previousStyleState = null;
        pendingStyleState = null;
        pendingStyleStateSince = 0;
      }

      // ── Snap on first frame or after seek ─────────────────────────────────
      if (!initialized || isSeek) {
        posNx = pos.nx;
        posNy = pos.ny;
        velNx = 0;
        velNy = 0;
        dispVelNx = 0;
        dispVelNy = 0;
        smoothTargetNx = pos.nx;
        smoothTargetNy = pos.ny;
        clickScalePos = 1;
        clickScaleVel = 0;
        smoothedRotation = 0;
        rotVel = 0;
        activeStyleState = resolveCursorStyleState(pos.cursorType);
        previousStyleState = null;
        styleStateTransitionStartedAt = t;
        pendingStyleState = null;
        pendingStyleStateSince = 0;
        initialized = true;
      }

      // Compute press/click state once — used both for click-scale spring and drawing.
      const held = isPressedAtTime(pressEvents, t);
      const recentClick = ripples.some((r) => t - r.createdAt < CLICK_PRESS_DURATION);
      const pressed = held || recentClick;
      const style: CursorStyleId = normalizeCursorStyle(cursorStyle);
      const textureFor = (state: CursorStyleState): CursorTexture =>
        style === 'cursor01'
          ? svgTextures[state]
          : vectorTextures(style, state, pressed, cursorColor, cursorLabel, t);

      if (dt > 0) {
        // Pre-filter: 80% toward raw each frame ≈ 4 ms effective lag at 60 fps.
        smoothTargetNx = smoothTargetNx * (1 - SMOOTH_ALPHA) + pos.nx * SMOOTH_ALPHA;
        smoothTargetNy = smoothTargetNy * (1 - SMOOTH_ALPHA) + pos.ny * SMOOTH_ALPHA;

        // Anti-overshoot velocity clamps (critical-velocity + already-crossed).
        const ySpring = 0.6931471805599453 / cursorHalflife;
        const errX = posNx - smoothTargetNx;
        const errY = posNy - smoothTargetNy;
        if (errX > 0 && velNx < -errX * ySpring) {
          velNx = -errX * ySpring;
        }
        if (errX < 0 && velNx > -errX * ySpring) {
          velNx = -errX * ySpring;
        }
        if (errY > 0 && velNy < -errY * ySpring) {
          velNy = -errY * ySpring;
        }
        if (errY < 0 && velNy > -errY * ySpring) {
          velNy = -errY * ySpring;
        }
        if ((errX < 0 && velNx < 0) || (errX > 0 && velNx > 0)) {
          velNx = 0;
        }
        if ((errY < 0 && velNy < 0) || (errY > 0 && velNy > 0)) {
          velNy = 0;
        }

        [posNx, velNx] = springDamp(posNx, velNx, smoothTargetNx, cursorHalflife, dt);
        [posNy, velNy] = springDamp(posNy, velNy, smoothTargetNy, cursorHalflife, dt);

        // EMA-smooth display velocity to prevent motion blur / tilt snap.
        dispVelNx = dispVelNx * (1 - DISP_VEL_ALPHA) + velNx * DISP_VEL_ALPHA;
        dispVelNy = dispVelNy * (1 - DISP_VEL_ALPHA) + velNy * DISP_VEL_ALPHA;

        // Click-scale spring — subtle shrink on press/click then spring back.
        const scaleTarget = pressed ? (cursorClickShrink ? SHRINK_PRESS_SCALE : PRESS_SCALE) : 1.0;
        [clickScalePos, clickScaleVel] = springDamp(
          clickScalePos,
          clickScaleVel,
          scaleTarget,
          0.04,
          dt,
        );
      }

      // ── Velocity-driven rotation ───────────────────────────────────────────
      const cvx = dispVelNx * scene.sourceWidth * frameScale * zoomScale;
      const cvy = dispVelNy * scene.sourceHeight * frameScale * zoomScale;
      const speed = Math.sqrt(cvx * cvx + cvy * cvy);
      const MAX_TILT = (cursorMaxTilt * Math.PI) / 180;
      const TILT_SPEED_SCALE = 600;
      const tiltFactor = Math.min(speed / TILT_SPEED_SCALE, 1);
      const targetRotation =
        speed > 10 ? (Math.atan2(cvy, cvx) * tiltFactor * MAX_TILT) / (Math.PI / 2) : 0;

      // Spring smoothedRotation toward target, resolving ±π wrap for shortest path.
      let diff = targetRotation - smoothedRotation;
      if (diff > Math.PI) {
        diff -= 2 * Math.PI;
      }
      if (diff < -Math.PI) {
        diff += 2 * Math.PI;
      }
      [smoothedRotation, rotVel] = springDamp(
        smoothedRotation,
        rotVel,
        smoothedRotation + diff,
        0.1,
        dt,
      );
      const cursorPoint = toCanvasPoint(posNx, posNy);
      const cx = cursorPoint.x;
      const cy = cursorPoint.y;
      const totalScale = baseScale * clickScalePos;

      const transitionProgress =
        previousStyleState && isStyleStateCursor
          ? Math.min((t - styleStateTransitionStartedAt) / STYLE_CROSSFADE_DURATION, 1)
          : 1;

      // Ghost sprites use the outgoing state during crossfade so the trail
      // doesn't abruptly change shape mid-transition.
      const motionBlurState: CursorStyleState =
        previousStyleState && isStyleStateCursor && transitionProgress < 1
          ? previousStyleState
          : activeStyleState;

      // ── Motion blur ghosts ─────────────────────────────────────────────────
      void pressed; // click-scale already captured above
      if (isVisible && cursorMotionBlur && speed >= SPEED_THRESHOLD) {
        const MAX_OFFSET = Math.min(speed * dt * 3, 36 * baseScale);
        for (let i = 0; i < MOTION_BLUR_STEPS; i++) {
          const tStep = (i + 1) / MOTION_BLUR_STEPS;
          const opacity = (1 - tStep) * 0.18;
          const ox = -(cvx / speed) * MAX_OFFSET * tStep;
          const oy = -(cvy / speed) * MAX_OFFSET * tStep;
          const ghost = ghostSprites[i];
          ghost.visible = true;
          ghost.alpha = opacity;
          positionCursorSprite(
            ghost,
            textureFor(motionBlurState),
            cx + ox,
            cy + oy,
            totalScale,
            smoothedRotation,
          );
        }
      } else {
        for (const ghost of ghostSprites) {
          ghost.visible = false;
        }
      }

      // ── Ripple rings ───────────────────────────────────────────────────────
      for (let i = 0; i < ripplePool.length; i++) {
        const g = ripplePool[i];
        g.clear();
        if (isVisible && cursorClickEffect === 'ripple' && i < ripples.length) {
          const ripple = ripples[i];
          const progress = (t - ripple.createdAt) / RIPPLE_DURATION;
          const rp = toCanvasPoint(ripple.nx, ripple.ny);
          const radius = 32 * baseScale * progress;
          const opacity = (1 - progress) * 0.55;
          g.alpha = opacity;
          g.circle(rp.x, rp.y, radius);
          g.stroke({ color: 0xffffff, width: 1.5 * baseScale });
        }
      }

      // ── Effects layer ──────────────────────────────────────────────────────
      if (isVisible && effectsCtx && needsEffectsOverlay(cursorClickEffect, cursorEffect)) {
        // Soft effects don't need more than 1080p of detail; keeps 4K uploads cheap.
        const k = Math.min(1, 1080 / Math.max(ch, 1));
        const ew = Math.max(1, Math.round(cw * k));
        const eh = Math.max(1, Math.round(ch * k));
        if (effectsCanvas.width !== ew || effectsCanvas.height !== eh) {
          effectsCanvas.width = ew;
          effectsCanvas.height = eh;
          effectsSprite.texture.source.resize(ew, eh);
        }
        effectsCtx.setTransform(1, 0, 0, 1, 0, 0);
        effectsCtx.clearRect(0, 0, ew, eh);
        effectsCtx.setTransform(k, 0, 0, k, 0, 0);
        const recent = findClicksInWindow(clickEvents, t, MAX_CLICK_EFFECT_DURATION);
        const latest = recent.length > 0 ? clickEvents[recent[recent.length - 1]] : null;
        drawCursorEffects(effectsCtx, {
          t,
          scale: baseScale,
          width: cw,
          height: ch,
          clickEffect: cursorClickEffect,
          cursorEffect,
          cursor: { x: cx, y: cy },
          clicks: recent.map((index) => {
            const click = clickEvents[index];
            const point = toCanvasPoint(click.nx, click.ny);
            return { x: point.x, y: point.y, t: click.t, seed: index + 1 };
          }),
          pointAt: (time) => {
            const at = interpolateCursor(moveEvents, time);
            return at ? toCanvasPoint(at.nx, at.ny) : null;
          },
          sinceClick: latest ? t - latest.t : null,
        });
        effectsSprite.texture.source.update();
        effectsSprite.scale.set(1 / k);
        effectsSprite.visible = true;
      } else {
        effectsSprite.visible = false;
      }

      // ── Magnifier ──────────────────────────────────────────────────────────
      if (!recordingSprite || recordingSprite.destroyed) {
        recordingSprite = scene.videoContainer.getChildByLabel(
          RECORDING_VIDEO_SPRITE_LABEL,
          true,
        ) as Sprite | null;
      }
      if (
        isVisible &&
        cursorEffect === 'magnifier' &&
        recordingSprite &&
        recordingSprite.visible &&
        recordingSprite.texture !== Texture.EMPTY
      ) {
        // The recording's transform relative to this layer, then zoomed about the cursor.
        scene.motionOverlayContainer.getGlobalTransform(overlayMatrix, false).invert();
        recordingSprite.getGlobalTransform(lensMatrix, false);
        overlayMatrix
          .append(lensMatrix)
          .translate(-cx, -cy)
          .scale(MAGNIFIER_ZOOM, MAGNIFIER_ZOOM)
          .translate(cx, cy);
        lensSprite.texture = recordingSprite.texture;
        lensSprite.anchor.copyFrom(recordingSprite.anchor);
        lensSprite.setFromMatrix(overlayMatrix);
        const radius = MAGNIFIER_RADIUS * baseScale;
        lensMask.clear().circle(cx, cy, radius).fill(0xffffff);
        lensRing
          .clear()
          .circle(cx, cy, radius + 1.2 * baseScale)
          .stroke({ color: 0x000000, width: 1 * baseScale, alpha: 0.25 })
          .circle(cx, cy, radius)
          .stroke({ color: 0xffffff, width: 2.5 * baseScale });
        lens.visible = true;
      } else {
        lens.visible = false;
      }

      // ── Cursor sprites ─────────────────────────────────────────────────────
      if (!isVisible) {
        mainSprite.visible = false;
        prevSprite.visible = false;
        return;
      }

      if (previousStyleState && isStyleStateCursor && transitionProgress < 1) {
        // Crossfade: outgoing fades out, incoming fades in.
        prevSprite.visible = true;
        prevSprite.alpha = 1 - transitionProgress;
        positionCursorSprite(
          prevSprite,
          textureFor(previousStyleState),
          cx,
          cy,
          totalScale,
          smoothedRotation,
        );

        mainSprite.visible = true;
        mainSprite.alpha = transitionProgress;
        positionCursorSprite(
          mainSprite,
          textureFor(activeStyleState),
          cx,
          cy,
          totalScale,
          smoothedRotation,
        );
      } else {
        if (transitionProgress >= 1) {
          previousStyleState = null;
        }
        prevSprite.visible = false;
        mainSprite.visible = true;
        mainSprite.alpha = 1;
        positionCursorSprite(
          mainSprite,
          textureFor(activeStyleState),
          cx,
          cy,
          totalScale,
          smoothedRotation,
        );
      }
    };
  },
};
