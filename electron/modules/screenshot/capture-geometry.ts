/**
 * Pure helpers for still captures (no Electron imports, unit-tested).
 */
import type { ScreenshotCaptureRequest, SelectedArea } from '../../../src/types/index';
import { WAYLAND_PICKED_WINDOW_ID } from '../../../src/lib/recording/waylandPicker';

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface DisplayLike {
  id: number;
  size: Size;
  scaleFactor: number;
}

export interface SourceLike {
  id: string;
  display_id: string;
}

export function getDisplayPixelSize(display: DisplayLike): Size {
  return {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
}

/**
 * desktopCapturer thumbnails are fitted inside `thumbnailSize`, so asking for
 * the largest display's native pixel size yields a full-resolution still.
 */
export function getCaptureThumbnailSize(displays: readonly DisplayLike[]): Size {
  if (displays.length === 0) {
    return { width: 1920, height: 1080 };
  }
  return displays.reduce<Size>(
    (acc, display) => {
      const px = getDisplayPixelSize(display);
      return { width: Math.max(acc.width, px.width), height: Math.max(acc.height, px.height) };
    },
    { width: 0, height: 0 },
  );
}

export interface CaptureDisplays {
  /** The display an area was drawn on (the selector covers the primary display). */
  target: DisplayLike;
  all: readonly DisplayLike[];
}

const ASPECT_TOLERANCE = 0.01;

function sameAspect(a: Size, b: Size): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
    return false;
  }
  return Math.abs(a.width / a.height - b.width / b.height) <= ASPECT_TOLERANCE;
}

/**
 * Whether a lone screen source that isn't labelled as the area's display is
 * still certainly that display. Cropping any other monitor with the area gives
 * the wrong image; when in doubt, it isn't.
 */
function isCertainlyTarget<T extends SourceLike>(
  source: T,
  displays: CaptureDisplays,
  sizeOf: ((source: T) => Size) | undefined,
): boolean {
  const others = displays.all.filter((d) => d.id !== displays.target.id);
  if (others.some((d) => String(d.id) === source.display_id)) {
    return false;
  }
  if (others.length === 0) {
    return true;
  }
  // Unlabelled (the Linux portal hands back whichever monitor the user picked):
  // only the image's shape can tell, and only if no other display shares it.
  const size = sizeOf?.(source);
  if (!size || !sameAspect(size, getDisplayPixelSize(displays.target))) {
    return false;
  }
  return !others.some((d) => sameAspect(size, getDisplayPixelSize(d)));
}

/**
 * The display an area belongs to: the one the selector covered, if it's still
 * there at the same size. Null when it's gone or was resized, since the area's
 * coordinates no longer describe it. An area without a display (older callers)
 * belongs to the primary.
 */
export function resolveAreaDisplay<D extends DisplayLike>(
  area: SelectedArea,
  displays: readonly D[],
  primary: D,
): D | null {
  if (!area.display) {
    return primary;
  }
  const { id, width, height } = area.display;
  const display = displays.find((d) => d.id === id);
  if (!display || display.size.width !== width || display.size.height !== height) {
    return null;
  }
  return display;
}

export function pickSourceForCapture<T extends SourceLike>(
  sources: readonly T[],
  request: ScreenshotCaptureRequest,
  displays: CaptureDisplays,
  /** The source's image size, used to recognise an unlabelled target display. */
  sizeOf?: (source: T) => Size,
): T | null {
  const screens = sources.filter((source) => source.id.startsWith('screen:'));
  // When ids don't match (a re-plugged display, the synthetic Wayland portal
  // source), only a lone screen is a safe guess: with several, a guess could
  // capture the wrong monitor, so fail and let the user pick again.
  const onlyScreen = screens.length === 1 ? screens[0] : null;

  if (request.kind === 'area') {
    // The area only fits an image of the display it was drawn on.
    const target = screens.find((source) => source.display_id === String(displays.target.id));
    if (target) {
      return target;
    }
    return onlyScreen && isCertainlyTarget(onlyScreen, displays, sizeOf) ? onlyScreen : null;
  }

  const exact = sources.find((source) => source.id === request.sourceId);
  if (exact) {
    return exact;
  }
  if (request.kind === 'display') {
    return onlyScreen;
  }
  // Wayland: the window was picked in the share dialog, which returns only that one. A real
  // window id that is gone never falls back to another window.
  if (request.sourceId === WAYLAND_PICKED_WINDOW_ID) {
    const windows = sources.filter((source) => source.id.startsWith('window:'));
    return windows.length === 1 ? windows[0] : null;
  }
  return null;
}

/** Maps a selection in display DIPs to a clamped integer rect in image pixels. */
export function areaToImageRect(area: Rect, displaySize: Size, imageSize: Size): Rect | null {
  const sx = imageSize.width / Math.max(displaySize.width, 1);
  const sy = imageSize.height / Math.max(displaySize.height, 1);
  const left = Math.max(0, Math.round(area.x * sx));
  const top = Math.max(0, Math.round(area.y * sy));
  const right = Math.min(imageSize.width, Math.round((area.x + area.width) * sx));
  const bottom = Math.min(imageSize.height, Math.round((area.y + area.height) * sy));
  if (right <= left || bottom <= top) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Maps a selection in display DIPs to a clamped rect in global screen
 * coordinates (whole points), as macOS `screencapture -R` takes it.
 */
export function areaToScreenRect(area: Rect, display: { bounds: Rect; size: Size }): Rect | null {
  const left = Math.max(0, Math.round(area.x));
  const top = Math.max(0, Math.round(area.y));
  const right = Math.min(display.size.width, Math.round(area.x + area.width));
  const bottom = Math.min(display.size.height, Math.round(area.y + area.height));
  if (right <= left || bottom <= top) {
    return null;
  }
  return {
    x: display.bounds.x + left,
    y: display.bounds.y + top,
    width: right - left,
    height: bottom - top,
  };
}

export function fitWithin(size: Size, max: Size): Size {
  const scale = Math.min(1, max.width / size.width, max.height / size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}
