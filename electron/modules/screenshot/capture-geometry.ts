/**
 * Pure helpers for still captures (no Electron imports, unit-tested).
 */
import type { ScreenshotCaptureRequest } from '../../../src/types/index';

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
  primary: DisplayLike;
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
 * Whether a lone screen source that isn't labelled as the primary display is
 * still certainly the primary. The area was drawn on the primary, so cropping
 * any other monitor with it gives the wrong image; when in doubt, it isn't.
 */
function isCertainlyPrimary<T extends SourceLike>(
  source: T,
  displays: CaptureDisplays,
  sizeOf: ((source: T) => Size) | undefined,
): boolean {
  const others = displays.all.filter((d) => d.id !== displays.primary.id);
  if (others.some((d) => String(d.id) === source.display_id)) {
    return false;
  }
  if (others.length === 0) {
    return true;
  }
  // Unlabelled (the Linux portal hands back whichever monitor the user picked):
  // only the image's shape can tell, and only if no other display shares it.
  const size = sizeOf?.(source);
  if (!size || !sameAspect(size, getDisplayPixelSize(displays.primary))) {
    return false;
  }
  return !others.some((d) => sameAspect(size, getDisplayPixelSize(d)));
}

export function pickSourceForCapture<T extends SourceLike>(
  sources: readonly T[],
  request: ScreenshotCaptureRequest,
  displays: CaptureDisplays,
  /** The source's image size, used to recognise an unlabelled primary display. */
  sizeOf?: (source: T) => Size,
): T | null {
  const screens = sources.filter((source) => source.id.startsWith('screen:'));
  // When ids don't match (a re-plugged display, the synthetic Wayland portal
  // source), only a lone screen is a safe guess: with several, a guess could
  // capture the wrong monitor, so fail and let the user pick again.
  const onlyScreen = screens.length === 1 ? screens[0] : null;

  if (request.kind === 'area') {
    // The area selector window always covers the primary display, so the
    // area only fits an image of the primary display.
    const primary = screens.find((source) => source.display_id === String(displays.primary.id));
    if (primary) {
      return primary;
    }
    return onlyScreen && isCertainlyPrimary(onlyScreen, displays, sizeOf) ? onlyScreen : null;
  }

  const exact = sources.find((source) => source.id === request.sourceId);
  if (exact) {
    return exact;
  }
  if (request.kind === 'display') {
    return onlyScreen;
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

export function fitWithin(size: Size, max: Size): Size {
  const scale = Math.min(1, max.width / size.width, max.height / size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}
