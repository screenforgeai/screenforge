import type {
  ProjectCameraSettings,
  ProjectKeyboardSettings,
  SavedProject,
  StoredProjectLike,
} from '../../../types';
import type { BackgroundSettings, CropRect, FrameSettings } from './index';
import { fitWindowWithBar } from '../../window-bar/geometry';
import { activeBarStyle } from '../../window-bar/types';
import {
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_CURSOR_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
} from '../../../store/defaults';

const MIN_CROP_SIZE_PX = 2;

export interface AspectRatioPreset {
  id: string;
  label: string;
  width: number | null;
  height: number | null;
}

export const ASPECT_RATIO_PRESETS: AspectRatioPreset[] = [
  { id: 'original', label: 'Original', width: null, height: null },
  { id: '16:9', label: '16:9', width: 16, height: 9 },
  { id: '9:16', label: '9:16', width: 9, height: 16 },
  { id: '1:1', label: '1:1', width: 1, height: 1 },
  { id: '4:5', label: '4:5', width: 4, height: 5 },
  { id: '4:3', label: '4:3', width: 4, height: 3 },
];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type PixelRect = Rect;

export function getAspectRatioPreset(aspectRatioId: string): AspectRatioPreset {
  return (
    ASPECT_RATIO_PRESETS.find((preset) => preset.id === aspectRatioId) ?? ASPECT_RATIO_PRESETS[0]
  );
}

export function resolveAspectRatioValue(
  aspectRatioId: string,
  sourceWidth: number,
  sourceHeight: number,
): number {
  const preset = getAspectRatioPreset(aspectRatioId);
  if (!preset.width || !preset.height) {
    return sourceWidth / Math.max(sourceHeight, 1);
  }
  return preset.width / preset.height;
}

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  type: 'wallpaper',
  solidColor: '#0f0f14',
  gradientPresetId: 'ocean',
  gradientFrom: '#0d1b2a',
  gradientTo: '#1b4332',
  gradientAngle: 135,
  padding: 0.2,
  cornerRadius: 12,
  shadowBlur: 24,
  shadowOpacity: 0.5,
  wallpaperSeed: 0,
  blurIntensity: 0.6,
};

export const DEFAULT_CROP_RECT: CropRect = {
  x: 0,
  y: 0,
  width: 1,
  height: 1,
};

export const DEFAULT_FRAME: FrameSettings = {
  aspectRatioId: 'original',
  cropRect: DEFAULT_CROP_RECT,
  background: DEFAULT_BACKGROUND,
};

function roundEven(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toPixelRect(rect: CropRect, sourceWidth: number, sourceHeight: number): PixelRect {
  return {
    x: rect.x * sourceWidth,
    y: rect.y * sourceHeight,
    width: rect.width * sourceWidth,
    height: rect.height * sourceHeight,
  };
}

function toAlignedPixelRect(rect: CropRect, sourceWidth: number, sourceHeight: number): PixelRect {
  const raw = toPixelRect(rect, sourceWidth, sourceHeight);
  const left = clamp(Math.round(raw.x), 0, Math.max(sourceWidth - 1, 0));
  const top = clamp(Math.round(raw.y), 0, Math.max(sourceHeight - 1, 0));
  const right = clamp(Math.round(raw.x + raw.width), left + 1, sourceWidth);
  const bottom = clamp(Math.round(raw.y + raw.height), top + 1, sourceHeight);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function toNormalizedRect(rect: PixelRect, sourceWidth: number, sourceHeight: number): CropRect {
  return {
    x: rect.x / sourceWidth,
    y: rect.y / sourceHeight,
    width: rect.width / sourceWidth,
    height: rect.height / sourceHeight,
  };
}

/**
 * The crop for an exact pixel rect of a sourceWidth x sourceHeight video.
 * getFrameGeometry turns it back into exactly those pixels.
 */
export function cropRectFromPixels(
  rect: PixelRect,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  return toNormalizedRect(rect, sourceWidth, sourceHeight);
}

export function cloneFrameSettings(frame: FrameSettings): FrameSettings {
  return {
    aspectRatioId: frame.aspectRatioId,
    cropRect: { ...frame.cropRect },
    background: { ...frame.background },
    ...(frame.windowBar && { windowBar: { ...frame.windowBar } }),
    ...(frame.recordedBar && { recordedBar: { ...frame.recordedBar } }),
  };
}

export function getLargestCenteredCropRect(
  sourceWidth: number,
  sourceHeight: number,
  aspectRatio: number,
): CropRect {
  const sourceRatio = sourceWidth / Math.max(sourceHeight, 1);
  if (aspectRatio >= sourceRatio) {
    const width = sourceWidth;
    const height = width / aspectRatio;
    return toNormalizedRect(
      { x: 0, y: (sourceHeight - height) / 2, width, height },
      sourceWidth,
      sourceHeight,
    );
  }

  const height = sourceHeight;
  const width = height * aspectRatio;
  return toNormalizedRect(
    { x: (sourceWidth - width) / 2, y: 0, width, height },
    sourceWidth,
    sourceHeight,
  );
}

export function normalizeCropRect(
  rect: CropRect | null | undefined,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  if (!rect) {
    return { ...DEFAULT_CROP_RECT };
  }

  const widthPx = clamp(
    rect.width * sourceWidth,
    Math.min(MIN_CROP_SIZE_PX, sourceWidth),
    sourceWidth,
  );
  const heightPx = clamp(
    rect.height * sourceHeight,
    Math.min(MIN_CROP_SIZE_PX, sourceHeight),
    sourceHeight,
  );
  const x = clamp(rect.x * sourceWidth, 0, sourceWidth - widthPx);
  const y = clamp(rect.y * sourceHeight, 0, sourceHeight - heightPx);

  return toNormalizedRect({ x, y, width: widthPx, height: heightPx }, sourceWidth, sourceHeight);
}

export function resetCropRect(): CropRect {
  return { ...DEFAULT_CROP_RECT };
}

export function moveCropRect(
  rect: CropRect,
  deltaXNormalized: number,
  deltaYNormalized: number,
): CropRect {
  return {
    ...rect,
    x: clamp(rect.x + deltaXNormalized, 0, 1 - rect.width),
    y: clamp(rect.y + deltaYNormalized, 0, 1 - rect.height),
  };
}

export type CropHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export function resizeCropRectFromHandle(
  rect: CropRect,
  handle: CropHandle,
  pointerSourceX: number,
  pointerSourceY: number,
  sourceWidth: number,
  sourceHeight: number,
): CropRect {
  const current = toPixelRect(rect, sourceWidth, sourceHeight);
  const minWidth = Math.min(MIN_CROP_SIZE_PX, sourceWidth);
  const minHeight = Math.min(MIN_CROP_SIZE_PX, sourceHeight);

  let left = current.x;
  let right = current.x + current.width;
  let top = current.y;
  let bottom = current.y + current.height;

  if (handle.includes('w')) {
    left = clamp(pointerSourceX, 0, right - minWidth);
  }
  if (handle.includes('e')) {
    right = clamp(pointerSourceX, left + minWidth, sourceWidth);
  }
  if (handle.includes('n')) {
    top = clamp(pointerSourceY, 0, bottom - minHeight);
  }
  if (handle.includes('s')) {
    bottom = clamp(pointerSourceY, top + minHeight, sourceHeight);
  }

  return toNormalizedRect(
    {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    },
    sourceWidth,
    sourceHeight,
  );
}

export interface FrameGeometry {
  canvasWidth: number;
  canvasHeight: number;
  aspectRatio: number;
  contentRect: Rect;
  cropRectPixels: Rect;
  /** The recording itself (the page, under any window bar). */
  mediaRect: Rect;
  /** The whole window: the window bar plus mediaRect. Equals mediaRect with no bar. */
  windowRect: Rect;
  /** Window bar height in canvas px; 0 with no bar. */
  barHeight: number;
}

/** Whether a frame draws a window bar. */
export function hasWindowBar(frame: Pick<FrameSettings, 'windowBar'>): boolean {
  return activeBarStyle(frame.windowBar) !== 'none';
}

/** Vertical (9:16) frames get the compact bar: dots and domain only. */
export function isCompactWindowBar(frame: Pick<FrameSettings, 'aspectRatioId'>): boolean {
  return frame.aspectRatioId === '9:16';
}

/** The window (bar + recording) contained in a content box. */
function fitMedia(
  frame: FrameSettings,
  contentRect: Rect,
  cropWidth: number,
  cropHeight: number,
): { mediaRect: Rect; windowRect: Rect; barHeight: number } {
  const barStyle = activeBarStyle(frame.windowBar);
  if (barStyle === 'none') {
    const fit = getContainRect(contentRect.width, contentRect.height, cropWidth, cropHeight);
    const mediaRect = {
      x: contentRect.x + fit.x,
      y: contentRect.y + fit.y,
      width: fit.width,
      height: fit.height,
    };
    return { mediaRect, windowRect: { ...mediaRect }, barHeight: 0 };
  }
  const fit = fitWindowWithBar(
    contentRect.x,
    contentRect.y,
    contentRect.width,
    contentRect.height,
    cropWidth,
    cropHeight,
    barStyle,
  );
  return { mediaRect: fit.media, windowRect: fit.window, barHeight: fit.barHeight };
}

export function getFrameGeometry(
  frame: FrameSettings,
  sourceWidth: number,
  sourceHeight: number,
): FrameGeometry {
  const aspectRatio = resolveAspectRatioValue(frame.aspectRatioId, sourceWidth, sourceHeight);

  // Compute crop rect first — it is in source pixel space and independent of canvas size.
  const cropRectPixels = toAlignedPixelRect(frame.cropRect, sourceWidth, sourceHeight);

  // For "original" AR the canvas matches the effective crop so the content always
  // fills the frame without letterboxing regardless of padding value.
  const canvasHeight = frame.aspectRatioId === 'original' ? cropRectPixels.height : sourceHeight;
  const canvasWidth =
    frame.aspectRatioId === 'original'
      ? cropRectPixels.width
      : roundEven(canvasHeight * aspectRatio);

  const padding = frame.background.padding;

  const contentRect = {
    x: (padding * canvasWidth) / 2,
    y: (padding * canvasHeight) / 2,
    width: canvasWidth * (1 - padding),
    height: canvasHeight * (1 - padding),
  };
  return {
    canvasWidth,
    canvasHeight,
    aspectRatio,
    contentRect,
    cropRectPixels,
    ...fitMedia(frame, contentRect, cropRectPixels.width, cropRectPixels.height),
  };
}

/**
 * Like getFrameGeometry but positions contentRect/mediaRect within a sub-panel of the
 * canvas rather than the full canvas. Used for side-by-side camera layouts where the
 * recording renders in one panel and the camera in the other.
 *
 * `insetPx` overrides the panel inset (in canvas pixels). When omitted, falls back to
 * frame.background.padding — but for side layouts, pass a small pixel inset (e.g.,
 * canvasHeight * SIDE_LAYOUT_PADDING_RATIO) so the recording fills its panel.
 *
 * canvasWidth/canvasHeight (for background rendering) are preserved from the base geometry.
 */
export function getFrameGeometryForPanel(
  frame: FrameSettings,
  sourceWidth: number,
  sourceHeight: number,
  panelX: number,
  panelY: number,
  panelWidth: number,
  panelHeight: number,
  insetPx?: number,
): FrameGeometry {
  const base = getFrameGeometry(frame, sourceWidth, sourceHeight);
  let contentX: number;
  let contentY: number;
  let contentW: number;
  let contentH: number;
  if (insetPx !== undefined) {
    contentX = panelX + insetPx;
    contentY = panelY + insetPx;
    contentW = Math.max(1, panelWidth - insetPx * 2);
    contentH = Math.max(1, panelHeight - insetPx * 2);
  } else {
    const padding = frame.background.padding;
    contentX = panelX + (padding * panelWidth) / 2;
    contentY = panelY + (padding * panelHeight) / 2;
    contentW = panelWidth * (1 - padding);
    contentH = panelHeight * (1 - padding);
  }
  const contentRect = { x: contentX, y: contentY, width: contentW, height: contentH };
  return {
    ...base,
    contentRect,
    ...fitMedia(frame, contentRect, base.cropRectPixels.width, base.cropRectPixels.height),
  };
}

export function getContainRect(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number,
): Rect {
  const scale = Math.min(
    containerWidth / Math.max(contentWidth, 1),
    containerHeight / Math.max(contentHeight, 1),
  );
  const width = contentWidth * scale;
  const height = contentHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}

export function normalizeFrameSettings(
  frame: Partial<FrameSettings> | null | undefined,
  legacyBackground: BackgroundSettings | undefined,
  sourceWidth: number,
  sourceHeight: number,
): FrameSettings {
  const aspectRatioId = frame?.aspectRatioId ?? DEFAULT_FRAME.aspectRatioId;
  const background = {
    ...DEFAULT_FRAME.background,
    ...(legacyBackground ?? {}),
    ...(frame?.background ?? {}),
  };

  return {
    aspectRatioId,
    cropRect: normalizeCropRect(
      frame?.cropRect ?? DEFAULT_FRAME.cropRect,
      sourceWidth,
      sourceHeight,
    ),
    background,
    ...(frame?.windowBar && { windowBar: { ...frame.windowBar } }),
    ...(frame?.recordedBar && { recordedBar: { ...frame.recordedBar } }),
  };
}

export function normalizeSavedProject(project: StoredProjectLike): SavedProject {
  const rawShape = (project.camera as { shape?: string } | undefined)?.shape;
  const camera: ProjectCameraSettings = {
    ...DEFAULT_CAMERA_SETTINGS,
    ...(project.camera ?? {}),
    shape:
      rawShape === 'original'
        ? 'horizontal'
        : rawShape === 'square' || rawShape === 'horizontal' || rawShape === 'vertical'
          ? rawShape
          : DEFAULT_CAMERA_SETTINGS.shape,
    enabled: project.camera?.enabled ?? Boolean(project.result.cameraPath),
    shadow: {
      ...DEFAULT_CAMERA_SETTINGS.shadow,
      ...(project.camera?.shadow ?? {}),
    },
  };
  const rawKeyboardSize = project.keyboard?.size;
  const rawKeyboardBackground = project.keyboard?.background;
  const keyboard: ProjectKeyboardSettings = {
    ...DEFAULT_KEYBOARD_SETTINGS,
    ...(project.keyboard ?? {}),
    size:
      rawKeyboardSize === 'small' || rawKeyboardSize === 'medium' || rawKeyboardSize === 'large'
        ? rawKeyboardSize
        : DEFAULT_KEYBOARD_SETTINGS.size,
    background:
      rawKeyboardBackground === 'dark' || rawKeyboardBackground === 'light'
        ? rawKeyboardBackground
        : DEFAULT_KEYBOARD_SETTINGS.background,
    position: 'bottom-center',
  };

  return {
    ...project,
    frame: normalizeFrameSettings(
      project.frame,
      project.background,
      project.result.recordingArea.width,
      project.result.recordingArea.height,
    ),
    cursor: {
      ...DEFAULT_CURSOR_SETTINGS,
      ...(project.cursor ?? {}),
    },
    camera,
    keyboard,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cameraClips: (project as any).cameraClips ?? [],
  };
}
