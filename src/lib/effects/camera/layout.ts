import type { CameraLayoutPreset, CameraShape, ProjectCameraSettings } from '../../../types';
import type { CameraClip } from '../../../types/timeline';

const MIN_CAMERA_WIDTH_RATIO = 0.08;
const MAX_CAMERA_WIDTH_RATIO = 0.65;
const MAX_CAMERA_HEIGHT_RATIO = 0.9;

// Side-layout camera panel width as a fraction of canvas width (left/right layouts).
export const SIDE_LAYOUT_WIDTH_RATIO = 0.3;
// Minimum side-layout panel ratio — prevents the camera panel from becoming too narrow.
const SIDE_LAYOUT_MIN_WIDTH_RATIO = 0.15;
// Fallback padding ratio — used only when camera.fixedPadding is unavailable.
export const SIDE_LAYOUT_PADDING_RATIO = 0.01; // ~11px on 1080p
// Zoom scale at which the fixed-layout camera finishes popping out to a floating overlay.
const SIDE_LAYOUT_POPOUT_END_ZOOM = 1.3;

function sideLayoutPopoutAlpha(zoomScale: number): number {
  return easeInOut(clamp((zoomScale - 1) / (SIDE_LAYOUT_POPOUT_END_ZOOM - 1), 0, 1));
}

export interface CameraRect {
  x: number;
  y: number;
  width: number;
  height: number;
  baseX: number;
  baseY: number;
  baseWidth: number;
  baseHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getCameraAspectRatio(shape: CameraShape): number {
  if (shape === 'square') {
    return 1;
  }
  if (shape === 'vertical') {
    return 9 / 16;
  }
  return 16 / 9;
}

export function getZoomAdjustedCameraScale(
  camera: ProjectCameraSettings,
  zoomScale: number,
): number {
  const safeZoom = Math.max(1, zoomScale);
  const response = clamp(camera.zoomResponse, 0, 1);
  const scale = 1 / (1 + response * (safeZoom - 1));
  return clamp(scale, 0.35, 1);
}

export function resolveCameraRect(
  camera: ProjectCameraSettings,
  canvasWidth: number,
  canvasHeight: number,
  zoomScale = 1,
): CameraRect {
  const aspect = getCameraAspectRatio(camera.shape);
  const zoomAdjustedScale = getZoomAdjustedCameraScale(camera, zoomScale);

  const maxWidth = canvasWidth * MAX_CAMERA_WIDTH_RATIO;
  const minWidth = canvasWidth * MIN_CAMERA_WIDTH_RATIO;
  let baseWidth = clamp(camera.size, MIN_CAMERA_WIDTH_RATIO, MAX_CAMERA_WIDTH_RATIO) * canvasWidth;
  let baseHeight = baseWidth / Math.max(aspect, 0.01);

  const maxHeight = canvasHeight * MAX_CAMERA_HEIGHT_RATIO;
  if (baseHeight > maxHeight) {
    baseHeight = maxHeight;
    baseWidth = baseHeight * aspect;
  }

  let width = clamp(baseWidth * zoomAdjustedScale, minWidth, maxWidth);
  let height = width / Math.max(aspect, 0.01);
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }

  const baseMaxX = Math.max(0, canvasWidth - baseWidth);
  const baseMaxY = Math.max(0, canvasHeight - baseHeight);
  const baseX = clamp(camera.x * canvasWidth, 0, baseMaxX);
  const baseY = clamp(camera.y * canvasHeight, 0, baseMaxY);

  const maxX = Math.max(0, canvasWidth - width);
  const maxY = Math.max(0, canvasHeight - height);
  const x = clamp(baseX + (baseWidth - width) / 2, 0, maxX);
  const y = clamp(baseY + (baseHeight - height) / 2, 0, maxY);

  return { x, y, width, height, baseX, baseY, baseWidth, baseHeight };
}

export function getCameraCornerRadius(
  camera: ProjectCameraSettings,
  width: number,
  height: number,
): number {
  return clamp(camera.roundness, 0, 1) * (Math.min(width, height) / 2);
}

export function toNormalizedX(x: number, canvasWidth: number): number {
  return clamp(x / Math.max(1, canvasWidth), 0, 1);
}

export function toNormalizedY(y: number, canvasHeight: number): number {
  return clamp(y / Math.max(1, canvasHeight), 0, 1);
}

export function toNormalizedSize(width: number, canvasWidth: number): number {
  return clamp(width / Math.max(1, canvasWidth), MIN_CAMERA_WIDTH_RATIO, MAX_CAMERA_WIDTH_RATIO);
}

export function getMinCameraWidth(canvasWidth: number): number {
  return Math.max(1, canvasWidth * MIN_CAMERA_WIDTH_RATIO);
}

export function clampCameraPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: clamp(x, 0, Math.max(0, canvasWidth - width)),
    y: clamp(y, 0, Math.max(0, canvasHeight - height)),
  };
}

function easeInOut(t: number): number {
  const c = clamp(t, 0, 1);
  return -(Math.cos(Math.PI * c) - 1) / 2;
}

export interface ResolvedCameraPosition {
  x: number;
  y: number;
  size: number;
}

const TRANSITION_HALF_S = 0.25;

export function resolveCameraPositionAtTime(
  clips: CameraClip[],
  time: number,
): ResolvedCameraPosition | null {
  if (clips.length === 0) {
    return null;
  }

  const sorted = [...clips].sort((a, b) => a.start - b.start);

  let activeIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (time >= sorted[i].start && time < sorted[i].end) {
      activeIdx = i;
      break;
    }
  }
  if (activeIdx === -1) {
    const last = sorted[sorted.length - 1];
    if (last && Math.abs(time - last.end) < 0.002) {
      activeIdx = sorted.length - 1;
    }
  }
  if (activeIdx === -1) {
    return null;
  }

  const clip = sorted[activeIdx];
  const nextClip = sorted[activeIdx + 1] ?? null;
  const prevClip = sorted[activeIdx - 1] ?? null;

  if (nextClip && time >= clip.end - TRANSITION_HALF_S && time <= clip.end + TRANSITION_HALF_S) {
    const alpha = easeInOut((time - (clip.end - TRANSITION_HALF_S)) / (TRANSITION_HALF_S * 2));
    return {
      x: clip.x + (nextClip.x - clip.x) * alpha,
      y: clip.y + (nextClip.y - clip.y) * alpha,
      size: clip.size + (nextClip.size - clip.size) * alpha,
    };
  }

  if (prevClip && time <= clip.start + TRANSITION_HALF_S) {
    const alpha = easeInOut((time - clip.start + TRANSITION_HALF_S) / (TRANSITION_HALF_S * 2));
    return {
      x: prevClip.x + (clip.x - prevClip.x) * alpha,
      y: prevClip.y + (clip.y - prevClip.y) * alpha,
      size: prevClip.size + (clip.size - prevClip.size) * alpha,
    };
  }

  return { x: clip.x, y: clip.y, size: clip.size };
}

// ── Layout-aware resolution ───────────────────────────────────────────────────

function getClipLayout(clip: CameraClip): CameraLayoutPreset {
  return clip.layout ?? 'pip';
}

// Computes the target rect the camera pops out to during zoom in fixed layouts.
// Scale is driven by zoomResponse so the user's setting actually shrinks the floating camera.
function shrinkRectForPopout(
  rect: CameraRect,
  layout: 'left' | 'right',
  camera: ProjectCameraSettings,
  zoomScale: number,
): CameraRect {
  const scale = getZoomAdjustedCameraScale(camera, zoomScale);
  const w = rect.width * scale;
  const h = rect.height * scale;
  const y = rect.y + (rect.height - h) / 2;
  const x = layout === 'right' ? rect.x + (rect.width - w) : rect.x;
  return { x, y, width: w, height: h, baseX: x, baseY: y, baseWidth: w, baseHeight: h };
}

function computeClipRect(
  clip: CameraClip,
  camera: ProjectCameraSettings,
  canvasWidth: number,
  canvasHeight: number,
  zoomScale: number,
): CameraRect {
  const layout = getClipLayout(clip);
  if (layout === 'full') {
    return {
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      baseX: 0,
      baseY: 0,
      baseWidth: canvasWidth,
      baseHeight: canvasHeight,
    };
  }
  if (layout === 'left') {
    const sideW = Math.max(
      canvasWidth * SIDE_LAYOUT_WIDTH_RATIO,
      canvasWidth * SIDE_LAYOUT_MIN_WIDTH_RATIO,
    );
    const pad = camera.fixedPadding * (canvasHeight / 1080);
    const sideRect: CameraRect = {
      x: pad,
      y: pad,
      width: sideW - pad * 2,
      height: canvasHeight - pad * 2,
      baseX: pad,
      baseY: pad,
      baseWidth: sideW - pad * 2,
      baseHeight: canvasHeight - pad * 2,
    };
    const popoutAlpha = sideLayoutPopoutAlpha(zoomScale);
    if (popoutAlpha === 0) {
      return sideRect;
    }
    return lerpRect(
      sideRect,
      shrinkRectForPopout(sideRect, 'left', camera, zoomScale),
      popoutAlpha,
    );
  }
  if (layout === 'right') {
    const sideW = Math.max(
      canvasWidth * SIDE_LAYOUT_WIDTH_RATIO,
      canvasWidth * SIDE_LAYOUT_MIN_WIDTH_RATIO,
    );
    const panelX = canvasWidth - sideW;
    const pad = camera.fixedPadding * (canvasHeight / 1080);
    const sideRect: CameraRect = {
      x: panelX + pad,
      y: pad,
      width: sideW - pad * 2,
      height: canvasHeight - pad * 2,
      baseX: panelX + pad,
      baseY: pad,
      baseWidth: sideW - pad * 2,
      baseHeight: canvasHeight - pad * 2,
    };
    const popoutAlpha = sideLayoutPopoutAlpha(zoomScale);
    if (popoutAlpha === 0) {
      return sideRect;
    }
    return lerpRect(
      sideRect,
      shrinkRectForPopout(sideRect, 'right', camera, zoomScale),
      popoutAlpha,
    );
  }
  // pip: use clip's own x/y/size
  return resolveCameraRect(
    { ...camera, x: clip.x, y: clip.y, size: clip.size },
    canvasWidth,
    canvasHeight,
    zoomScale,
  );
}

export function lerpRect(a: CameraRect, b: CameraRect, alpha: number): CameraRect {
  return {
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    width: a.width + (b.width - a.width) * alpha,
    height: a.height + (b.height - a.height) * alpha,
    baseX: a.baseX + (b.baseX - a.baseX) * alpha,
    baseY: a.baseY + (b.baseY - a.baseY) * alpha,
    baseWidth: a.baseWidth + (b.baseWidth - a.baseWidth) * alpha,
    baseHeight: a.baseHeight + (b.baseHeight - a.baseHeight) * alpha,
  };
}

/**
 * Computes a camera rect whose HEIGHT matches the recording video height so both
 * frames share the same vertical extent. Width is capped by the camera panel width.
 * The rect is horizontally centred in the camera panel and vertically centred on canvas.
 */
export function getSideLayoutMatchedCameraRect(
  layout: CameraLayoutPreset,
  camera: ProjectCameraSettings,
  canvasWidth: number,
  canvasHeight: number,
  recordingMediaHeight: number,
): CameraRect {
  const sideW = canvasWidth * SIDE_LAYOUT_WIDTH_RATIO;
  const insetPx = camera.fixedPadding * (canvasHeight / 1080);
  const camPanelX = layout === 'left' ? 0 : canvasWidth - sideW;
  const camPanelW = sideW;
  const maxCamW = camPanelW - insetPx * 2;
  const camAspect = getCameraAspectRatio(camera.shape);
  const idealW = recordingMediaHeight * camAspect;
  const finalW = Math.min(idealW, maxCamW);
  const finalH = finalW / Math.max(camAspect, 0.001);
  const cx = camPanelX + camPanelW / 2;
  const cy = canvasHeight / 2;
  const x = cx - finalW / 2;
  const y = cy - finalH / 2;
  return {
    x,
    y,
    width: finalW,
    height: finalH,
    baseX: x,
    baseY: y,
    baseWidth: finalW,
    baseHeight: finalH,
  };
}

function layoutRadius(
  layout: CameraLayoutPreset,
  camera: ProjectCameraSettings,
  width: number,
  height: number,
  zoomScale = 1,
  canvasHeight = 1080,
): number {
  if (layout === 'full') {
    return 0;
  }
  if (layout === 'left' || layout === 'right') {
    const panelRadius = camera.fixedRadius * (canvasHeight / 1080);
    const floatRadius = panelRadius * camera.zoomRadiusScale;
    const popoutAlpha = sideLayoutPopoutAlpha(zoomScale);
    return panelRadius + (floatRadius - panelRadius) * popoutAlpha;
  }
  // PiP: scale corner radius toward zoomRadiusScale as zoom increases (completes at zoom 2×)
  const baseRadius = getCameraCornerRadius(camera, width, height);
  const pipZoomAlpha = easeInOut(clamp(zoomScale - 1, 0, 1));
  return baseRadius + (baseRadius * camera.zoomRadiusScale - baseRadius) * pipZoomAlpha;
}

export interface ResolvedCameraLayout {
  rect: CameraRect;
  radius: number;
  layout: CameraLayoutPreset;
  /** Where the screen recording should render. null = full canvas (pip/full layouts). */
  screenRect: CameraRect | null;
  /** Corner radius for the screen recording panel (0 when screenRect is null). */
  screenRadius: number;
}

// Returns the rect the recording should render into for fixed layouts.
// null = full canvas (pip/full layouts, or camera fully popped out during zoom).
function computeScreenRect(
  clip: CameraClip,
  canvasWidth: number,
  canvasHeight: number,
  zoomScale = 1,
): CameraRect | null {
  const layout = getClipLayout(clip);
  if (layout !== 'left' && layout !== 'right') {
    return null;
  }

  const popoutAlpha = sideLayoutPopoutAlpha(zoomScale);
  if (popoutAlpha >= 1) {
    return null;
  }

  let screenRect: CameraRect;
  if (layout === 'left') {
    const sideW = Math.max(
      canvasWidth * SIDE_LAYOUT_WIDTH_RATIO,
      canvasWidth * SIDE_LAYOUT_MIN_WIDTH_RATIO,
    );
    screenRect = {
      x: sideW,
      y: 0,
      width: canvasWidth - sideW,
      height: canvasHeight,
      baseX: sideW,
      baseY: 0,
      baseWidth: canvasWidth - sideW,
      baseHeight: canvasHeight,
    };
  } else if (layout === 'right') {
    // Bug fix: recording occupies the LEFT (wider) panel when camera is on the right.
    const sideW = Math.max(
      canvasWidth * SIDE_LAYOUT_WIDTH_RATIO,
      canvasWidth * SIDE_LAYOUT_MIN_WIDTH_RATIO,
    );
    screenRect = {
      x: 0,
      y: 0,
      width: canvasWidth - sideW,
      height: canvasHeight,
      baseX: 0,
      baseY: 0,
      baseWidth: canvasWidth - sideW,
      baseHeight: canvasHeight,
    };
  }

  if (popoutAlpha === 0) {
    return screenRect;
  }

  const fullRect: CameraRect = {
    x: 0,
    y: 0,
    width: canvasWidth,
    height: canvasHeight,
    baseX: 0,
    baseY: 0,
    baseWidth: canvasWidth,
    baseHeight: canvasHeight,
  };
  const lerped = lerpRect(screenRect, fullRect, popoutAlpha);
  const isFullCanvas =
    Math.abs(lerped.x) < 0.5 &&
    Math.abs(lerped.y) < 0.5 &&
    Math.abs(lerped.width - canvasWidth) < 0.5 &&
    Math.abs(lerped.height - canvasHeight) < 0.5;
  return isFullCanvas ? null : lerped;
}

function getEquivScreenRect(
  clip: CameraClip,
  canvasWidth: number,
  canvasHeight: number,
  zoomScale = 1,
): CameraRect {
  return (
    computeScreenRect(clip, canvasWidth, canvasHeight, zoomScale) ?? {
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      baseX: 0,
      baseY: 0,
      baseWidth: canvasWidth,
      baseHeight: canvasHeight,
    }
  );
}

/**
 * Resolves the final camera rect and radius at a given timeline time, fully
 * accounting for per-clip layout presets (pip / full / left / right) and
 * smooth rect-level interpolation during clip transitions.
 *
 * Replaces the 2-step resolveCameraPositionAtTime + resolveCameraRect pattern
 * in the rendering pipelines.
 */
export function resolveCameraAtTime(
  clips: CameraClip[],
  time: number,
  camera: ProjectCameraSettings,
  canvasWidth: number,
  canvasHeight: number,
  zoomScale = 1,
): ResolvedCameraLayout | null {
  if (clips.length === 0) {
    return null;
  }

  const sorted = [...clips].sort((a, b) => a.start - b.start);

  let activeIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (time >= sorted[i].start && time < sorted[i].end) {
      activeIdx = i;
      break;
    }
  }
  if (activeIdx === -1) {
    const last = sorted[sorted.length - 1];
    if (last && Math.abs(time - last.end) < 0.002) {
      activeIdx = sorted.length - 1;
    }
  }
  if (activeIdx === -1) {
    return null;
  }

  const clip = sorted[activeIdx];
  const nextClip = sorted[activeIdx + 1] ?? null;
  const prevClip = sorted[activeIdx - 1] ?? null;
  const layout = getClipLayout(clip);

  const activeRect = computeClipRect(clip, camera, canvasWidth, canvasHeight, zoomScale);

  if (nextClip && time >= clip.end - TRANSITION_HALF_S && time <= clip.end + TRANSITION_HALF_S) {
    const t = clamp((time - (clip.end - TRANSITION_HALF_S)) / (TRANSITION_HALF_S * 2), 0, 1);
    const alpha = easeInOut(t);
    const nextRect = computeClipRect(nextClip, camera, canvasWidth, canvasHeight, zoomScale);
    const rect = lerpRect(activeRect, nextRect, alpha);
    const nextLayout = getClipLayout(nextClip);
    const radius =
      layoutRadius(layout, camera, activeRect.width, activeRect.height, zoomScale, canvasHeight) *
        (1 - alpha) +
      layoutRadius(nextLayout, camera, nextRect.width, nextRect.height, zoomScale, canvasHeight) *
        alpha;
    const srA = getEquivScreenRect(clip, canvasWidth, canvasHeight, zoomScale);
    const srB = getEquivScreenRect(nextClip, canvasWidth, canvasHeight, zoomScale);
    const lerpedSr = lerpRect(srA, srB, alpha);
    const isFullCanvas =
      Math.abs(lerpedSr.x) < 0.5 &&
      Math.abs(lerpedSr.y) < 0.5 &&
      Math.abs(lerpedSr.width - canvasWidth) < 0.5 &&
      Math.abs(lerpedSr.height - canvasHeight) < 0.5;
    return { rect, radius, layout, screenRect: isFullCanvas ? null : lerpedSr, screenRadius: 0 };
  }

  if (prevClip && time <= clip.start + TRANSITION_HALF_S) {
    const t = clamp((time - clip.start + TRANSITION_HALF_S) / (TRANSITION_HALF_S * 2), 0, 1);
    const alpha = easeInOut(t);
    const prevRect = computeClipRect(prevClip, camera, canvasWidth, canvasHeight, zoomScale);
    const prevLayout = getClipLayout(prevClip);
    const rect = lerpRect(prevRect, activeRect, alpha);
    const radius =
      layoutRadius(prevLayout, camera, prevRect.width, prevRect.height, zoomScale, canvasHeight) *
        (1 - alpha) +
      layoutRadius(layout, camera, activeRect.width, activeRect.height, zoomScale, canvasHeight) *
        alpha;
    const srA = getEquivScreenRect(prevClip, canvasWidth, canvasHeight, zoomScale);
    const srB = getEquivScreenRect(clip, canvasWidth, canvasHeight, zoomScale);
    const lerpedSr = lerpRect(srA, srB, alpha);
    const isFullCanvas =
      Math.abs(lerpedSr.x) < 0.5 &&
      Math.abs(lerpedSr.y) < 0.5 &&
      Math.abs(lerpedSr.width - canvasWidth) < 0.5 &&
      Math.abs(lerpedSr.height - canvasHeight) < 0.5;
    return { rect, radius, layout, screenRect: isFullCanvas ? null : lerpedSr, screenRadius: 0 };
  }

  return {
    rect: activeRect,
    radius: layoutRadius(
      layout,
      camera,
      activeRect.width,
      activeRect.height,
      zoomScale,
      canvasHeight,
    ),
    layout,
    screenRect: computeScreenRect(clip, canvasWidth, canvasHeight, zoomScale),
    screenRadius: 0,
  };
}
