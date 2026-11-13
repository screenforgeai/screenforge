/**
 * Zoom effect — PixiJS implementation.
 *
 * Replaces the Canvas 2D ctx.scale() + ctx.translate() middleware with GPU
 * Container transforms on cameraContainer. All spring-physics and camera
 * interpolation logic is copied verbatim from the Canvas 2D version.
 */
import { useStore } from '../../../store';
import type { CinematicTiltMode, MediaSegment, ZoomClip } from '../../../types/timeline';
import type { PixiEffect, PixiEffectUpdater } from '../../pixi/types';
import { Rectangle } from 'pixi.js';
import { interpolateCursor } from '../cursor/render';
import type { CursorData } from '../cursor/analyze';
import { resolveAutoFollowAxis, type FollowDirection } from './follow';
import { interpolateCamera, resolveCinematicZoomState } from './render';
import {
  setSharedCameraIdentity,
  setSharedCameraTransform,
  setSharedPerspectiveState,
} from './index';
import { detectZoomClips } from './analyze';
import { getZoomCrop, toCropSpacePoint, toCropSpaceRecording } from './crop-space';
import { SharpenFilter } from '../../pixi/filters/SharpenFilter';
import { CinematicZoomFilter } from '../../pixi/filters/CinematicZoomFilter';
import { smoothFilterEdges } from '../../pixi/smoothEdges';
import { sortMediaSegments } from '../../helpers/segments';
import { getFrameGeometry } from '../frame/analyze';
import type { CropRect } from '../frame';

const CAM_HALFLIFE = 0.08;
const CAMERA_FOLLOW_START_SCALE = 1.32;
const CAMERA_FOLLOW_FULL_SCALE = 1.9;
const CINEMATIC_TILT_FOCUS_HALFLIFE_X = 0.055;
const CINEMATIC_TILT_FOCUS_HALFLIFE_Y = 0.18;
const CINEMATIC_TILT_FOLLOW_HALFLIFE_X = 2.5;
const CINEMATIC_TILT_FOLLOW_HALFLIFE_Y = 4.0;
const CINEMATIC_TILT_FOCUS_MAX_DT = 1 / 15;
const CINEMATIC_DEFAULT_TILT = 0.65;
const CINEMATIC_TILT_RAMP_SCALE = 1.45;
const CINEMATIC_MAX_TILT_STRENGTH = 1.35;
const CINEMATIC_DEPTH_RESPONSE = 1.6;
const CINEMATIC_BACKGROUND_FADE_RESPONSE = 1.65;
const CINEMATIC_PERSPECTIVE_FOCUS_HALFLIFE = 0.09;
const CINEMATIC_PERSPECTIVE_MAX_DT = 1 / 20;
const CINEMATIC_FILTER_MIN_AMOUNT = 0.003;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

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

function snapToRendererPixel(value: number, resolution: number): number {
  const safeResolution = Number.isFinite(resolution) ? Math.max(1, resolution) : 1;
  return Math.round(value * safeResolution) / safeResolution;
}

export interface PixelSnappedZoomTransform {
  pivotX: number;
  pivotY: number;
  positionX: number;
  positionY: number;
  scale: number;
}

export interface CinematicTiltState {
  amount: number;
  rotation: number;
  skewX: number;
  skewY: number;
}

export interface CinematicTiltFocus {
  nx: number;
  ny: number;
}

export interface StabilizedCinematicFocusState {
  nx: number;
  ny: number;
  velNx: number;
  velNy: number;
  initialized: boolean;
}

function normalizeCinematicTiltFocus(focus: CinematicTiltFocus): CinematicTiltFocus {
  return {
    nx: clamp(Number.isFinite(focus.nx) ? focus.nx : 0.5, 0, 1),
    ny: clamp(Number.isFinite(focus.ny) ? focus.ny : 0.5, 0, 1),
  };
}

export function resolveSourceTimeAtTimelineTime(
  timelineTime: number | null,
  segments: MediaSegment[],
): number | null {
  if (timelineTime === null || !Number.isFinite(timelineTime)) {
    return null;
  }

  if (segments.length === 0) {
    return timelineTime;
  }

  for (const seg of segments) {
    if (seg.videoEnabled === false) {
      continue;
    }
    const atEnd = Math.abs(timelineTime - seg.timelineEnd) <= 0.0001;
    if (timelineTime < seg.timelineStart || (timelineTime > seg.timelineEnd && !atEnd)) {
      continue;
    }
    return seg.sourceStart + (timelineTime - seg.timelineStart);
  }

  return null;
}

export function getCinematicTiltFocusCacheKey(
  tiltMode: CinematicTiltMode,
  clipId: string | null,
  clipStart: number | null,
  mode: ZoomClip['mode'],
  crop?: CropRect,
): string | null {
  if (!clipId || tiltMode === 'follow') {
    return null;
  }

  // The focus is a position in the crop, so a new crop needs a new lock.
  const cropKey = crop ? `:${crop.x},${crop.y},${crop.width},${crop.height}` : '';
  return `${clipId}:${Number.isFinite(clipStart) ? clipStart : 'unknown'}:${mode}${cropKey}`;
}

export function resolveCinematicTiltFocusTarget(
  current: CinematicTiltFocus,
  options: {
    tiltMode: CinematicTiltMode;
    clipId: string | null;
    clipStart: number | null;
    mode: ZoomClip['mode'];
    crop?: CropRect;
    cache: Map<string, CinematicTiltFocus>;
    resolveStartFocus?: () => CinematicTiltFocus | null;
  },
): CinematicTiltFocus {
  const currentFocus = normalizeCinematicTiltFocus(current);
  const cacheKey = getCinematicTiltFocusCacheKey(
    options.tiltMode,
    options.clipId,
    options.clipStart,
    options.mode,
    options.crop,
  );

  if (!cacheKey) {
    return currentFocus;
  }

  const cached = options.cache.get(cacheKey);
  if (cached) {
    return normalizeCinematicTiltFocus(cached);
  }

  const startFocus = options.resolveStartFocus?.() ?? currentFocus;
  const lockedFocus = normalizeCinematicTiltFocus(startFocus);
  options.cache.set(cacheKey, lockedFocus);
  return lockedFocus;
}

export interface CameraContainerTransform extends PixelSnappedZoomTransform {
  rotation: number;
  skewX: number;
  skewY: number;
}

export interface CinematicFilterSettings {
  enabled: boolean;
  centerX: number;
  centerY: number;
  innerRadius: number;
  strength: number;
  farBlurPixels: number;
  depthAmount: number;
  fadeAmount: number;
  splitX: number;
  splitY: number;
  chromaticEnabled: boolean;
  contrast: number;
  saturation: number;
  brightness: number;
}

export interface CinematicPerspectiveSettings {
  enabled: boolean;
  amount: number;
  focusX: number;
  focusY: number;
  aspect: number;
}

export interface CinematicContentBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface SmoothedCinematicPerspectiveState {
  amount: number;
  amountVel: number;
  focusX: number;
  focusY: number;
  focusVelX: number;
  focusVelY: number;
  aspect: number;
  initialized: boolean;
}

export function shouldEnableCinematicFilter(amount: number, blurStrength: number): boolean {
  const safeAmount = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  void blurStrength;
  return safeAmount >= CINEMATIC_FILTER_MIN_AMOUNT;
}

export function resolvePixelSnappedZoomTransform(
  pivotX: number,
  pivotY: number,
  scale: number,
  resolution: number,
): PixelSnappedZoomTransform {
  return {
    pivotX: 0,
    pivotY: 0,
    positionX: snapToRendererPixel(pivotX * (1 - scale), resolution),
    positionY: snapToRendererPixel(pivotY * (1 - scale), resolution),
    scale,
  };
}

function resolveDirectionalBias(value: number): number {
  const safeValue = Number.isFinite(value) ? value : 0.5;
  return clamp((safeValue - 0.5) * 2, -1, 1);
}

function resolveCinematicTiltStrength(tilt: number): number {
  const safeTilt = clamp(Number.isFinite(tilt) ? tilt : CINEMATIC_DEFAULT_TILT, 0, 1);
  return clamp(safeTilt / CINEMATIC_DEFAULT_TILT, 0, CINEMATIC_MAX_TILT_STRENGTH);
}

export function resolveCinematicTilt(
  amount: number,
  focus: CinematicTiltFocus = { nx: 0.62, ny: 0.58 },
  tilt = CINEMATIC_DEFAULT_TILT,
): CinematicTiltState {
  const safeAmount = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  const tiltEnvelope = clamp(safeAmount * CINEMATIC_TILT_RAMP_SCALE, 0, 1);
  const tiltAmount = tiltEnvelope * resolveCinematicTiltStrength(tilt);
  if (tiltAmount === 0) {
    return {
      amount: 0,
      rotation: 0,
      skewX: 0,
      skewY: 0,
    };
  }

  const horizontalBias = resolveDirectionalBias(focus.nx);

  return {
    amount: tiltAmount,
    rotation: clamp(-0.098 * horizontalBias, -0.15, 0.15) * tiltAmount,
    skewX: 0,
    skewY: 0,
  };
}

export function resolveCinematicFocusPoint(
  focusCx: number,
  focusCy: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number,
): { x: number; y: number } {
  const safePadding = clamp(padding, 0, 0.95);

  return {
    x: clamp((safePadding / 2 + focusCx * (1 - safePadding)) * canvasWidth, 0, canvasWidth),
    y: clamp((safePadding / 2 + focusCy * (1 - safePadding)) * canvasHeight, 0, canvasHeight),
  };
}

export function transformPointWithCameraTransform(
  x: number,
  y: number,
  transform: CameraContainerTransform,
): { x: number; y: number } {
  const { scale, pivotX, pivotY, positionX, positionY, rotation, skewX, skewY } = transform;
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

export function resolveCinematicContentBounds(
  rect: { x: number; y: number; width: number; height: number },
  transform: CameraContainerTransform,
  canvasWidth: number,
  canvasHeight: number,
): CinematicContentBounds {
  const safeWidth = Math.max(canvasWidth, 1);
  const safeHeight = Math.max(canvasHeight, 1);
  const inset = -Math.max(4, Math.min(safeWidth, safeHeight) * 0.006);
  const x0 = rect.x + inset;
  const y0 = rect.y + inset;
  const x1 = rect.x + rect.width - inset;
  const y1 = rect.y + rect.height - inset;
  const corners = [
    transformPointWithCameraTransform(x0, y0, transform),
    transformPointWithCameraTransform(x1, y0, transform),
    transformPointWithCameraTransform(x1, y1, transform),
    transformPointWithCameraTransform(x0, y1, transform),
  ];

  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

export function resolveCinematicCameraTransform(
  pivotX: number,
  pivotY: number,
  scale: number,
  resolution: number,
  tilt: CinematicTiltState,
): CameraContainerTransform {
  if (tilt.amount <= 0.005) {
    return {
      ...resolvePixelSnappedZoomTransform(pivotX, pivotY, scale, resolution),
      rotation: 0,
      skewX: 0,
      skewY: 0,
    };
  }

  return {
    pivotX,
    pivotY,
    positionX: snapToRendererPixel(pivotX, resolution),
    positionY: snapToRendererPixel(pivotY, resolution),
    scale,
    rotation: tilt.rotation,
    skewX: tilt.skewX,
    skewY: tilt.skewY,
  };
}

export function resolveCinematicFilterSettings(
  amount: number,
  focusX: number,
  focusY: number,
  zoomScale: number,
  canvasWidth: number,
  canvasHeight: number,
  options: {
    focus?: number;
    motionBlur?: number;
    depth?: number;
    backgroundFade?: number;
  } = {},
): CinematicFilterSettings {
  const safeAmount = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  void zoomScale;
  if (safeAmount <= 0.005) {
    return {
      enabled: false,
      centerX: 0,
      centerY: 0,
      innerRadius: 0,
      strength: 0,
      farBlurPixels: 0,
      depthAmount: 0,
      fadeAmount: 0,
      splitX: 0,
      splitY: 0,
      chromaticEnabled: false,
      contrast: 1,
      saturation: 1,
      brightness: 1,
    };
  }

  const safeWidth = Math.max(canvasWidth, 1);
  const safeHeight = Math.max(canvasHeight, 1);
  const centerX = clamp(focusX, 0, safeWidth);
  const centerY = clamp(focusY, 0, safeHeight);
  const safeDepth = clamp(
    typeof options.depth === 'number' && Number.isFinite(options.depth) ? options.depth : 0.65,
    0,
    1,
  );
  const safeFocus = clamp(
    typeof options.focus === 'number' && Number.isFinite(options.focus) ? options.focus : 0.75,
    0,
    1,
  );
  const safeBackgroundFade = clamp(
    typeof options.backgroundFade === 'number' && Number.isFinite(options.backgroundFade)
      ? options.backgroundFade
      : 0.75,
    0,
    1,
  );
  const effectiveDepth = clamp(safeDepth * CINEMATIC_DEPTH_RESPONSE, 0, 2);
  const effectiveBackgroundFade = clamp(
    safeBackgroundFade * CINEMATIC_BACKGROUND_FADE_RESPONSE,
    0,
    2,
  );
  const depthAmount = clamp(safeAmount * (0.48 + effectiveDepth * 0.38), 0, 1);
  const innerRadius = Math.min(safeWidth, safeHeight) * (0.09 + safeFocus * 0.2);
  const farBlurPixels = 0;

  return {
    enabled: true,
    centerX,
    centerY,
    innerRadius,
    strength: 0,
    farBlurPixels,
    depthAmount,
    fadeAmount: effectiveBackgroundFade,
    splitX: 0,
    splitY: 0,
    chromaticEnabled: false,
    contrast: 1,
    saturation: 1,
    brightness: 1,
  };
}

export function resolveCinematicPerspectiveSettings(
  amount: number,
  focus: CinematicTiltFocus,
  tilt = CINEMATIC_DEFAULT_TILT,
  canvasWidth: number,
  canvasHeight: number,
): CinematicPerspectiveSettings {
  const safeAmount = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  const tiltStrength = resolveCinematicTiltStrength(tilt);
  if (safeAmount <= 0.005 || tiltStrength <= 0.005) {
    return {
      enabled: false,
      amount: 0,
      focusX: 0.5,
      focusY: 0.5,
      aspect: 1,
    };
  }

  const perspectiveAmount = clamp(safeAmount * 0.4 * tiltStrength, 0, 0.5);
  const safeWidth = Math.max(canvasWidth, 1);
  const safeHeight = Math.max(canvasHeight, 1);
  const normalizedFocus = normalizeCinematicTiltFocus(focus);

  // Snap to just off-center so the projection pivot is near the middle of the
  // frame. This gives a symmetric 3D tilt (both sides transform proportionally)
  // rather than an asymmetric skew where one edge stays fixed.
  const focusX = normalizedFocus.nx < 0.5 ? 0.48 : 0.52;

  return {
    enabled: perspectiveAmount > 0.005,
    amount: perspectiveAmount,
    focusX,
    focusY: 0.5,
    aspect: safeWidth / safeHeight,
  };
}

function resolveSmoothedCinematicPerspectiveSettings(
  state: SmoothedCinematicPerspectiveState,
  target: CinematicPerspectiveSettings,
  dt: number,
): CinematicPerspectiveSettings {
  const targetAmount = target.enabled ? target.amount : 0;
  const targetFocusX = target.enabled
    ? clamp(Number.isFinite(target.focusX) ? target.focusX : 0.5, 0, 1)
    : state.focusX;
  const targetFocusY = target.enabled
    ? clamp(Number.isFinite(target.focusY) ? target.focusY : 0.5, 0, 1)
    : state.focusY;
  const targetAspect =
    target.enabled && Number.isFinite(target.aspect) ? target.aspect : state.aspect;

  if (!state.initialized) {
    state.amount = targetAmount;
    state.amountVel = 0;
    state.focusX = targetFocusX;
    state.focusY = targetFocusY;
    state.focusVelX = 0;
    state.focusVelY = 0;
    state.aspect = targetAspect;
    state.initialized = true;
  } else if (!Number.isFinite(dt) || dt <= 0) {
    state.amount = targetAmount;
    state.amountVel = 0;
    state.aspect = targetAspect;
  } else {
    const safeDt = clamp(dt, 0, CINEMATIC_PERSPECTIVE_MAX_DT);
    state.amount = targetAmount;
    state.amountVel = 0;
    [state.focusX, state.focusVelX] = springDamp(
      state.focusX,
      state.focusVelX,
      targetFocusX,
      CINEMATIC_PERSPECTIVE_FOCUS_HALFLIFE,
      safeDt,
    );
    [state.focusY, state.focusVelY] = springDamp(
      state.focusY,
      state.focusVelY,
      targetFocusY,
      CINEMATIC_PERSPECTIVE_FOCUS_HALFLIFE,
      safeDt,
    );
    state.amount = clamp(state.amount, 0, 0.42);
    state.focusX = clamp(state.focusX, 0, 1);
    state.focusY = clamp(state.focusY, 0, 1);
    state.aspect = targetAspect;
  }

  const enabled = state.amount > 0.003;
  if (!target.enabled && !enabled) {
    state.amount = 0;
    state.amountVel = 0;
  }

  return {
    enabled,
    amount: enabled ? state.amount : 0,
    focusX: state.focusX,
    focusY: state.focusY,
    aspect: state.aspect,
  };
}

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

export function resolveStabilizedCinematicFocus(
  state: StabilizedCinematicFocusState,
  target: CinematicTiltFocus,
  amount: number,
  dt: number,
  halflife:
    | number
    | {
        x?: number;
        y?: number;
      } = {
    x: CINEMATIC_TILT_FOCUS_HALFLIFE_X,
    y: CINEMATIC_TILT_FOCUS_HALFLIFE_Y,
  },
): CinematicTiltFocus {
  const targetNx = clamp(Number.isFinite(target.nx) ? target.nx : 0.5, 0, 1);
  const targetNy = clamp(Number.isFinite(target.ny) ? target.ny : 0.5, 0, 1);
  const safeAmount = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  const halflifeX =
    typeof halflife === 'number' ? halflife : (halflife.x ?? CINEMATIC_TILT_FOCUS_HALFLIFE_X);
  const halflifeY =
    typeof halflife === 'number' ? halflife : (halflife.y ?? CINEMATIC_TILT_FOCUS_HALFLIFE_Y);

  if (safeAmount <= 0.005) {
    state.nx = targetNx;
    state.ny = targetNy;
    state.velNx = 0;
    state.velNy = 0;
    state.initialized = false;
    return { nx: targetNx, ny: targetNy };
  }

  if (!state.initialized || !Number.isFinite(dt) || dt <= 0) {
    state.nx = targetNx;
    state.ny = targetNy;
    state.velNx = 0;
    state.velNy = 0;
    state.initialized = true;
    return { nx: targetNx, ny: targetNy };
  }

  const safeDt = clamp(dt, 0, CINEMATIC_TILT_FOCUS_MAX_DT);
  const yX = 0.6931471805599453 / Math.max(halflifeX, 1e-5);
  const yY = 0.6931471805599453 / Math.max(halflifeY, 1e-5);
  const ex = state.nx - targetNx;
  const ey = state.ny - targetNy;

  if (ex > 0 && state.velNx < -ex * yX) {
    state.velNx = -ex * yX;
  }
  if (ex < 0 && state.velNx > -ex * yX) {
    state.velNx = -ex * yX;
  }
  if (ey > 0 && state.velNy < -ey * yY) {
    state.velNy = -ey * yY;
  }
  if (ey < 0 && state.velNy > -ey * yY) {
    state.velNy = -ey * yY;
  }
  if ((ex < 0 && state.velNx < 0) || (ex > 0 && state.velNx > 0)) {
    state.velNx = 0;
  }
  if ((ey < 0 && state.velNy < 0) || (ey > 0 && state.velNy > 0)) {
    state.velNy = 0;
  }

  [state.nx, state.velNx] = springDamp(state.nx, state.velNx, targetNx, halflifeX, safeDt);
  [state.ny, state.velNy] = springDamp(state.ny, state.velNy, targetNy, halflifeY, safeDt);
  state.nx = clamp(state.nx, 0, 1);
  state.ny = clamp(state.ny, 0, 1);

  return { nx: state.nx, ny: state.ny };
}

function getCameraBounds(padding: number): { min: number; max: number } {
  const safePadding = clamp(padding, 0, 0.95);
  const contentSpan = Math.max(1 - safePadding, 0.05);
  const extension = safePadding / (2 * contentSpan);
  return { min: -extension, max: 1 + extension };
}

export const zoomPixiEffect: PixiEffect<ZoomClip[]> = {
  id: 'zoom',

  analyze(recording) {
    // Auto zoom targets are positions in the cropped picture, like manual ones.
    return detectZoomClips(toCropSpaceRecording(recording, getZoomCrop(useStore.getState())));
  },

  onLoad(data) {
    const { zoomClips, setZoom } = useStore.getState();
    if (zoomClips.length === 0) {
      setZoom(data);
    }
  },

  setup(_data, allData, scene): PixiEffectUpdater {
    const cursorData = allData.get('cursor') as CursorData | undefined;

    // Attach sharpening filter to stage once. Start disabled — PixiJS skips
    // the FBO pass entirely when disabled, so there is zero rendering overhead
    // during unzoomed playback. On first zoom the FBO is allocated; after that
    // enable/disable is free and never causes a pipeline rebuild.
    // Both filters wrap the frame while zoomed: keep its rounded corners antialiased.
    const sharpenFilter = smoothFilterEdges(new SharpenFilter(0.0));
    sharpenFilter.enabled = false;
    scene.app.stage.filters = [sharpenFilter];

    // Cinematic zoom is scoped to the preview surface so the backdrop stays flat
    // while the screen card and its shadow carry the optical treatment.
    const cinematicZoomFilter = smoothFilterEdges(new CinematicZoomFilter());
    cinematicZoomFilter.enabled = false;
    const cinematicFilterStack = [cinematicZoomFilter];
    const initScreen = scene.app.renderer.screen;
    const cinematicFilterArea = new Rectangle(
      initScreen.x,
      initScreen.y,
      Math.max(1, initScreen.width),
      Math.max(1, initScreen.height),
    );
    scene.frameContainer.filters = cinematicFilterStack;
    scene.frameContainer.filterArea = cinematicFilterArea;

    // Cache sorted segments to avoid re-sorting on every frame tick.
    let lastMediaSegmentsRef: MediaSegment[] | null = null;
    let cachedSortedSegs: MediaSegment[] = [];

    // Spring state in closure — same as Canvas 2D createFrameWrapper closure.
    let camCx = 0.5;
    let camCy = 0.5;
    let camVelCx = 0;
    let camVelCy = 0;
    let followXDirection: FollowDirection = 0;
    let followYDirection: FollowDirection = 0;
    let dzCursorNx = 0.5;
    let dzCursorNy = 0.5;
    let dzCursorVelNx = 0;
    let dzCursorVelNy = 0;
    const cinematicTiltFocusState: StabilizedCinematicFocusState = {
      nx: 0.5,
      ny: 0.5,
      velNx: 0,
      velNy: 0,
      initialized: false,
    };
    const cinematicPerspectiveState: SmoothedCinematicPerspectiveState = {
      amount: 0,
      amountVel: 0,
      focusX: 0.5,
      focusY: 0.5,
      focusVelX: 0,
      focusVelY: 0,
      aspect: 1,
      initialized: false,
    };
    const staticTiltFocusCache = new Map<string, CinematicTiltFocus>();
    let lastStaticTiltFocusKey: string | null = null;

    function resetCameraToPosition(nx: number, ny: number): void {
      camCx = nx;
      camCy = ny;
      camVelCx = 0;
      camVelCy = 0;
      dzCursorNx = nx;
      dzCursorNy = ny;
      dzCursorVelNx = 0;
      dzCursorVelNy = 0;
      cinematicTiltFocusState.nx = nx;
      cinematicTiltFocusState.ny = ny;
      cinematicTiltFocusState.velNx = 0;
      cinematicTiltFocusState.velNy = 0;
      cinematicTiltFocusState.initialized = false;
      cinematicPerspectiveState.amount = 0;
      cinematicPerspectiveState.amountVel = 0;
      cinematicPerspectiveState.focusX = nx;
      cinematicPerspectiveState.focusY = ny;
      cinematicPerspectiveState.focusVelX = 0;
      cinematicPerspectiveState.focusVelY = 0;
      cinematicPerspectiveState.aspect = 1;
      cinematicPerspectiveState.initialized = false;
      followXDirection = 0;
      followYDirection = 0;
    }

    // Sharpening to compensate for downscaling a Retina/HiDPI source in export
    // (scene.renderScale < 1). Formula: strength ∝ (1 − renderScale) so a
    // 3360→1920 export (renderScale≈0.57) gets ~0.39 base strength, while
    // preview (renderScale=1) stays at 0 and is unaffected.
    const baseSharpening = Math.max(0, (1 - scene.renderScale) * 0.9);

    function syncCinematicFilter(enabled: boolean): void {
      // Always keep filterArea set to canvas bounds so PixiJS never releases the
      // filter FBO between clips — toggling filterArea from undefined → Rectangle
      // forces a texture re-allocation that causes a first-frame stutter.
      const screen = scene.app.renderer.screen;
      cinematicFilterArea.x = screen.x;
      cinematicFilterArea.y = screen.y;
      cinematicFilterArea.width = Math.max(1, screen.width);
      cinematicFilterArea.height = Math.max(1, screen.height);
      scene.frameContainer.filterArea = cinematicFilterArea;
      cinematicZoomFilter.enabled = enabled;
    }

    function resetCinematicLookFilter(): void {
      cinematicZoomFilter.blurStrength = 0;
      cinematicZoomFilter.splitX = 0;
      cinematicZoomFilter.splitY = 0;
      cinematicZoomFilter.contrast = 1;
      cinematicZoomFilter.saturation = 1;
      cinematicZoomFilter.brightness = 1;
      cinematicZoomFilter.farBlurPixels = 0;
      cinematicZoomFilter.depthAmount = 0;
      cinematicZoomFilter.fadeAmount = 0;
    }

    function applyIdentityTransform(cx = 0.5, cy = 0.5): void {
      lastStaticTiltFocusKey = null;
      cinematicTiltFocusState.nx = cx;
      cinematicTiltFocusState.ny = cy;
      cinematicTiltFocusState.velNx = 0;
      cinematicTiltFocusState.velNy = 0;
      cinematicTiltFocusState.initialized = false;
      cinematicPerspectiveState.amount = 0;
      cinematicPerspectiveState.amountVel = 0;
      cinematicPerspectiveState.focusX = cx;
      cinematicPerspectiveState.focusY = cy;
      cinematicPerspectiveState.focusVelX = 0;
      cinematicPerspectiveState.focusVelY = 0;
      cinematicPerspectiveState.aspect = 1;
      cinematicPerspectiveState.initialized = false;
      scene.cameraContainer.scale.set(1);
      scene.cameraContainer.pivot.set(0, 0);
      scene.cameraContainer.position.set(0, 0);
      scene.cameraContainer.rotation = 0;
      scene.cameraContainer.skew.set(0, 0);
      scene.frameContainer.scale.set(1);
      scene.frameContainer.pivot.set(0, 0);
      scene.frameContainer.position.set(0, 0);
      scene.frameContainer.rotation = 0;
      scene.frameContainer.skew.set(0, 0);
      resetCinematicLookFilter();
      syncCinematicFilter(false);
      sharpenFilter.strength = baseSharpening;
      sharpenFilter.enabled = baseSharpening > 0;
      setSharedCameraIdentity(cx, cy);
      setSharedPerspectiveState({
        enabled: false,
        amount: 0,
        focusX: 0.5,
        focusY: 0.5,
        aspect: 1,
        canvasWidth: 1,
        canvasHeight: 1,
      });
    }

    function applyCinematicFilter(
      amount: number,
      perspectiveFocus: CinematicTiltFocus,
      depth: number,
      tilt: number,
      focus: number,
      backgroundFade: number,
      motionBlur: number,
      focusX: number,
      focusY: number,
      zoomScale: number,
      canvasWidth: number,
      canvasHeight: number,
      dt: number,
      contentBounds: CinematicContentBounds,
    ): void {
      const perspective = resolveSmoothedCinematicPerspectiveSettings(
        cinematicPerspectiveState,
        resolveCinematicPerspectiveSettings(
          amount,
          perspectiveFocus,
          tilt,
          canvasWidth,
          canvasHeight,
        ),
        dt,
      );
      const filter = resolveCinematicFilterSettings(
        amount,
        focusX,
        focusY,
        zoomScale,
        canvasWidth,
        canvasHeight,
        {
          focus,
          backgroundFade,
          motionBlur,
          depth,
        },
      );
      const enabled = shouldEnableCinematicFilter(amount, filter.strength);

      if (!enabled) {
        cinematicZoomFilter.perspectiveAmount = 0;
        resetCinematicLookFilter();
        syncCinematicFilter(false);
        setSharedPerspectiveState({
          enabled: false,
          amount: 0,
          focusX: 0.5,
          focusY: 0.5,
          aspect: 1,
          canvasWidth,
          canvasHeight,
        });
        return;
      }

      // The vertex shader owns the true 3D plane projection; the fragment
      // shader keeps texture reads local so dense UI text does not turn glassy.
      cinematicZoomFilter.perspectiveAmount = perspective.amount;
      cinematicZoomFilter.perspectiveFocusX = perspective.focusX;
      cinematicZoomFilter.perspectiveFocusY = perspective.focusY;
      cinematicZoomFilter.aspect = perspective.aspect;
      cinematicZoomFilter.blurCenterX = filter.centerX;
      cinematicZoomFilter.blurCenterY = filter.centerY;
      cinematicZoomFilter.innerRadius = filter.innerRadius;
      cinematicZoomFilter.blurStrength = filter.strength;
      cinematicZoomFilter.blurSampleCount = 1;
      cinematicZoomFilter.splitX = 0;
      cinematicZoomFilter.splitY = 0;
      cinematicZoomFilter.contrast = 1;
      cinematicZoomFilter.saturation = 1;
      cinematicZoomFilter.brightness = 1;
      cinematicZoomFilter.farBlurPixels = filter.farBlurPixels;
      cinematicZoomFilter.depthAmount = filter.depthAmount;
      cinematicZoomFilter.fadeAmount = filter.fadeAmount;
      cinematicZoomFilter.contentMinX = contentBounds.minX;
      cinematicZoomFilter.contentMinY = contentBounds.minY;
      cinematicZoomFilter.contentMaxX = contentBounds.maxX;
      cinematicZoomFilter.contentMaxY = contentBounds.maxY;
      syncCinematicFilter(true);
      setSharedPerspectiveState({
        enabled: perspective.amount > 0.001,
        amount: perspective.amount,
        focusX: perspective.focusX,
        focusY: perspective.focusY,
        aspect: perspective.aspect,
        canvasWidth,
        canvasHeight,
      });
    }

    return (t, dt) => {
      const state = useStore.getState();

      if (state.hiddenLayers.zoom) {
        applyIdentityTransform();
        return;
      }

      const clips = state.zoomClips as ZoomClip[];
      const { padding } = state.frame.background;
      const { cursorHalflife, cursorContinuousTracking, mediaSegments } = state;
      const bounds = getCameraBounds(padding);
      // The camera centres on positions in the cropped picture; the cursor's
      // are across the whole recording.
      const zoomCrop = getZoomCrop(state);
      const cursorPos = cursorData ? interpolateCursor(cursorData.moveEvents, t) : null;
      const pos = cursorPos ? toCropSpacePoint(cursorPos, zoomCrop) : null;

      if (mediaSegments !== lastMediaSegmentsRef) {
        cachedSortedSegs = sortMediaSegments(mediaSegments);
        lastMediaSegmentsRef = mediaSegments;
      }
      let clipT = t;
      for (const seg of cachedSortedSegs) {
        if (seg.videoEnabled === false) {
          continue;
        }
        const atEnd = Math.abs(t - seg.sourceEnd) <= 0.0001;
        if (t < seg.sourceStart || (t > seg.sourceEnd && !atEnd)) {
          continue;
        }
        clipT = seg.timelineStart + (t - seg.sourceStart) / (seg.speed ?? 1);
        break;
      }
      const target = interpolateCamera(clips, clipT, pos ?? undefined);
      const cinematic = resolveCinematicZoomState(clips, clipT, pos ?? undefined);

      if (!target) {
        if (pos) {
          resetCameraToPosition(
            clamp(pos.nx, bounds.min, bounds.max),
            clamp(pos.ny, bounds.min, bounds.max),
          );
        }
        applyIdentityTransform(camCx, camCy);
        return;
      }

      const scale = target.scale;

      // Dead-zone cursor spring — identical math to Canvas 2D version.
      if (pos && dt > 0) {
        const hl = Math.max(cursorHalflife, 1e-5);
        const yDz = 0.6931471805599453 / hl;
        const exDz = dzCursorNx - pos.nx;
        const eyDz = dzCursorNy - pos.ny;
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
        if ((exDz < 0 && dzCursorVelNx < 0) || (exDz > 0 && dzCursorVelNx > 0)) {
          dzCursorVelNx = 0;
        }
        if ((eyDz < 0 && dzCursorVelNy < 0) || (eyDz > 0 && dzCursorVelNy > 0)) {
          dzCursorVelNy = 0;
        }
        [dzCursorNx, dzCursorVelNx] = springDamp(dzCursorNx, dzCursorVelNx, pos.nx, hl, dt);
        [dzCursorNy, dzCursorVelNy] = springDamp(dzCursorNy, dzCursorVelNy, pos.ny, hl, dt);
      }

      let lazyCx = target.cx;
      let lazyCy = target.cy;
      let followBlend = 0;

      if (target.mode === 'auto' && pos && scale > 1.001) {
        if (cursorContinuousTracking) {
          lazyCx = camCx;
          lazyCy = camCy;
          followBlend = resolveCameraFollowBlend(scale);
          if (followBlend <= 0.001) {
            followXDirection = 0;
            followYDirection = 0;
          } else {
            const csX = scale * dzCursorNx + camCx * (1 - scale);
            const csY = scale * dzCursorNy + camCy * (1 - scale);
            const axisX = resolveAutoFollowAxis(
              csX,
              dzCursorNx,
              scale,
              dzCursorVelNx,
              followXDirection,
            );
            const axisY = resolveAutoFollowAxis(
              csY,
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
          followBlend = resolveCameraFollowBlend(scale);
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
      [camCx, camVelCx] = clampSpringToBounds(camCx, camVelCx, bounds.min, bounds.max);
      [camCy, camVelCy] = clampSpringToBounds(camCy, camVelCy, bounds.min, bounds.max);

      // GPU Container transform — replaces ctx.save/translate/scale/translate/restore.
      const canvasWidth = scene.app.renderer.width;
      const canvasHeight = scene.app.renderer.height;
      const rendererResolution = scene.app.renderer.resolution;
      const pivotX = (padding / 2 + camCx * (1 - padding)) * canvasWidth;
      const pivotY = (padding / 2 + camCy * (1 - padding)) * canvasHeight;
      const dynamicTiltFocus = {
        nx: cinematic.focusCx,
        ny: cinematic.focusCy,
      };
      const tiltFocusTarget = resolveCinematicTiltFocusTarget(dynamicTiltFocus, {
        tiltMode: cinematic.tiltMode,
        clipId: cinematic.clipId,
        clipStart: cinematic.clipStart,
        mode: cinematic.mode,
        crop: zoomCrop,
        cache: staticTiltFocusCache,
        resolveStartFocus: () => {
          if (cinematic.mode === 'manual' || !cursorData) {
            return dynamicTiltFocus;
          }

          const sourceStart = resolveSourceTimeAtTimelineTime(
            cinematic.clipStart,
            cachedSortedSegs,
          );
          if (sourceStart === null) {
            return dynamicTiltFocus;
          }

          const startPos = interpolateCursor(cursorData.moveEvents, sourceStart);
          return startPos
            ? toCropSpacePoint({ nx: startPos.nx, ny: startPos.ny }, zoomCrop)
            : dynamicTiltFocus;
        },
      });
      const staticTiltFocusKey = getCinematicTiltFocusCacheKey(
        cinematic.tiltMode,
        cinematic.clipId,
        cinematic.clipStart,
        cinematic.mode,
        zoomCrop,
      );
      if (staticTiltFocusKey !== lastStaticTiltFocusKey) {
        if (staticTiltFocusKey) {
          cinematicTiltFocusState.nx = tiltFocusTarget.nx;
          cinematicTiltFocusState.ny = tiltFocusTarget.ny;
          cinematicTiltFocusState.velNx = 0;
          cinematicTiltFocusState.velNy = 0;
          cinematicTiltFocusState.initialized = false;
        }
        lastStaticTiltFocusKey = staticTiltFocusKey;
      }
      const tiltHalflife =
        cinematic.tiltMode === 'follow'
          ? { x: CINEMATIC_TILT_FOLLOW_HALFLIFE_X, y: CINEMATIC_TILT_FOLLOW_HALFLIFE_Y }
          : undefined;
      const stabilizedTiltFocus = resolveStabilizedCinematicFocus(
        cinematicTiltFocusState,
        tiltFocusTarget,
        cinematic.amount,
        dt,
        tiltHalflife,
      );
      // Tilt direction is always user-controlled: 'left' = nx 0.2, 'right' = nx 0.8.
      const tiltNx = cinematic.tiltDirection === 'right' ? 0.8 : 0.2;
      const tilt = resolveCinematicTilt(
        cinematic.amount,
        {
          nx: tiltNx,
          ny: stabilizedTiltFocus.ny,
        },
        cinematic.tilt,
      );
      const cameraTransform = resolvePixelSnappedZoomTransform(
        pivotX,
        pivotY,
        target.scale,
        rendererResolution,
      );
      const surfaceTransform = resolveCinematicCameraTransform(
        pivotX,
        pivotY,
        1,
        rendererResolution,
        tilt,
      );
      const combinedTransform = resolveCinematicCameraTransform(
        pivotX,
        pivotY,
        target.scale,
        rendererResolution,
        tilt,
      );

      scene.cameraContainer.pivot.set(cameraTransform.pivotX, cameraTransform.pivotY);
      scene.cameraContainer.position.set(cameraTransform.positionX, cameraTransform.positionY);
      scene.cameraContainer.scale.set(cameraTransform.scale);
      scene.cameraContainer.rotation = 0;
      scene.cameraContainer.skew.set(0, 0);
      scene.frameContainer.pivot.set(surfaceTransform.pivotX, surfaceTransform.pivotY);
      scene.frameContainer.position.set(surfaceTransform.positionX, surfaceTransform.positionY);
      scene.frameContainer.scale.set(surfaceTransform.scale);
      scene.frameContainer.rotation = surfaceTransform.rotation;
      scene.frameContainer.skew.set(surfaceTransform.skewX, surfaceTransform.skewY);
      setSharedCameraTransform({
        cx: camCx,
        cy: camCy,
        scale: combinedTransform.scale,
        pivotX: combinedTransform.pivotX,
        pivotY: combinedTransform.pivotY,
        positionX: combinedTransform.positionX,
        positionY: combinedTransform.positionY,
        rotation: combinedTransform.rotation,
        skewX: combinedTransform.skewX,
        skewY: combinedTransform.skewY,
      });
      const focusPoint = resolveCinematicFocusPoint(
        cinematic.focusCx,
        cinematic.focusCy,
        canvasWidth,
        canvasHeight,
        padding,
      );
      const transformedFocusPoint = transformPointWithCameraTransform(
        focusPoint.x,
        focusPoint.y,
        combinedTransform,
      );
      const frameGeometry = getFrameGeometry(state.frame, scene.sourceWidth, scene.sourceHeight);
      const contentBounds = resolveCinematicContentBounds(
        frameGeometry.contentRect,
        combinedTransform,
        canvasWidth,
        canvasHeight,
      );
      // Use the same forced nx for the perspective shader so both rotation and
      // 3D projection always reflect the user-selected direction immediately.
      const perspectiveFocusForFilter: CinematicTiltFocus = {
        nx: tiltNx,
        ny: stabilizedTiltFocus.ny,
      };
      applyCinematicFilter(
        cinematic.amount,
        perspectiveFocusForFilter,
        cinematic.depth,
        cinematic.tilt,
        cinematic.focus,
        cinematic.backgroundFade,
        cinematic.motionBlur,
        transformedFocusPoint.x,
        transformedFocusPoint.y,
        combinedTransform.scale,
        canvasWidth,
        canvasHeight,
        dt,
        contentBounds,
      );

      // Sharpen filter gating — keeps the zoom ramp at 60fps.
      //
      // The FBO pass required by sharpenFilter.enabled costs ~25ms on typical
      // hardware, dropping the RAF from 60fps to ~22fps. During the easeIn/easeOut
      // ramp the content is moving fast and sharpness is imperceptible; only at
      // near-peak zoom does the image benefit from sharpening. So we gate the
      // filter ON only when scale > SHARPEN_GATE — the ramp stays at 60fps, the
      // peak stays sharp.
      //
      // Base: compensates for Retina source downscaling at scale=1 (export only).
      // Zoom ramp: 0 at 1× → 1.2 at 2× → 2.0 at ~2.7× (capped).
      const SHARPEN_GATE = 1.75;
      const sharpenGate = smootherStep(
        Math.max(0, (cameraTransform.scale - SHARPEN_GATE) / (2.0 - SHARPEN_GATE)),
      );
      const zoomSharpening = Math.max(0, (cameraTransform.scale - 1.0) * 1.2) * sharpenGate;
      const sharpenStrength = Math.min(2.0, baseSharpening + zoomSharpening);
      sharpenFilter.enabled = sharpenStrength > 0;
      sharpenFilter.strength = sharpenStrength;
    };
  },
};
