import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ClipboardItem,
  clipboard,
  desktopCapturer,
  nativeImage,
  screen,
  type Display,
} from 'electron';
import log from '../../lib/logger';
import { isPng, readPngSize } from '../../lib/png';
import type {
  ScreenshotCaptureData,
  ScreenshotCaptureRequest,
  SelectedArea,
} from '../../../src/types/index';
import {
  areaToImageRect,
  areaToScreenRect,
  fitWithin,
  getCaptureThumbnailSize,
  getDisplayPixelSize,
  pickSourceForCapture,
  resolveAreaDisplay,
} from './capture-geometry';

const SCREENCAPTURE_PATH = '/usr/sbin/screencapture';
const SCREENCAPTURE_TIMEOUT_MS = 10_000;

function runScreencapture(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(SCREENCAPTURE_PATH, args, { timeout: SCREENCAPTURE_TIMEOUT_MS }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

/**
 * macOS: grabs just the area with the system's `screencapture`, which renders
 * it at the display's backing resolution (Retina pixels), and hands back its
 * PNG bytes untouched: nothing is decoded or re-encoded here, the size comes
 * from the PNG header. Null when it can't, so the caller can fall back.
 */
async function captureAreaWithScreencapture(
  area: SelectedArea,
  display: Display,
): Promise<ScreenshotCaptureData | null> {
  const rect = areaToScreenRect(area, display);
  if (!rect) {
    throw new Error('The selected area is empty');
  }
  const file = path.join(tmpdir(), `screenforge-screenshot-${randomUUID()}.png`);
  try {
    // -x: no shutter sound (the renderer plays its own), -r: no DPI metadata.
    await runScreencapture([
      '-x',
      '-r',
      '-t',
      'png',
      '-R',
      `${rect.x},${rect.y},${rect.width},${rect.height}`,
      file,
    ]);
    const png = await readFile(file);
    const size = readPngSize(png);
    if (!size) {
      log.warn('[screenshot] screencapture wrote no image, using desktopCapturer');
      return null;
    }
    return { kind: 'area', png, ...size, scaleFactor: display.scaleFactor };
  } catch (error) {
    log.warn('[screenshot] screencapture failed, using desktopCapturer', { error });
    return null;
  } finally {
    await rm(file, { force: true }).catch(() => undefined);
  }
}

/**
 * Grabs a single still for a display, a window or an area of the primary
 * display. desktopCapturer thumbnails are real screen grabs, so asking for one
 * at native resolution avoids starting a capture stream for a single frame.
 */
export async function captureStill(
  request: ScreenshotCaptureRequest,
): Promise<ScreenshotCaptureData> {
  if (request.kind === 'area' && !request.area) {
    throw new Error('Area capture requested without an area');
  }
  const displaysBefore = screen.getAllDisplays();
  // The area's display as it is now: it decides the thumbnail size, and on
  // macOS where the area is on screen.
  const areaDisplayBefore =
    request.kind === 'area' && request.area
      ? resolveAreaDisplay(request.area, displaysBefore, screen.getPrimaryDisplay())
      : null;

  if (request.kind === 'area' && !areaDisplayBefore) {
    throw new Error('The display the area was selected on is gone or has changed');
  }

  if (
    request.kind === 'area' &&
    request.area &&
    areaDisplayBefore &&
    process.platform === 'darwin'
  ) {
    const native = await captureAreaWithScreencapture(request.area, areaDisplayBefore);
    if (native) {
      return native;
    }
  }

  const sources = await desktopCapturer.getSources({
    types: request.kind === 'window' ? ['window'] : ['screen'],
    // Thumbnails are scaled to fill thumbnailSize: sized for another (larger)
    // display, the area's display would be upscaled and resampled back, blurring it.
    thumbnailSize: getCaptureThumbnailSize(
      areaDisplayBefore ? [areaDisplayBefore] : displaysBefore,
    ),
    fetchWindowIcons: false,
  });
  // Read the displays after getSources: on Linux it waits on the portal picker,
  // and a display can be added or change resolution while that's open. The
  // source is matched (and cropped) against the displays as they are now.
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();

  // An area belongs to the display it was drawn on, even if the primary has
  // changed since; if that display is gone or resized, the area is meaningless.
  let areaDisplay = primary;
  if (request.kind === 'area' && request.area) {
    const resolved = resolveAreaDisplay(request.area, displays, primary);
    if (!resolved) {
      throw new Error('The display the area was selected on is gone or has changed');
    }
    areaDisplay = resolved;
  }

  const source = pickSourceForCapture(
    sources,
    request,
    { target: areaDisplay, all: displays },
    (s) => s.thumbnail.getSize(),
  );
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error(`No image available for ${request.kind} capture (${request.sourceId})`);
  }

  let image = source.thumbnail;
  // Pixels per point, for the window bar's size: a window's thumbnail comes at
  // the primary display's density (the closest guess without its bounds).
  let scaleFactor = primary.scaleFactor;
  if (request.kind !== 'window') {
    const display =
      request.kind === 'area'
        ? areaDisplay
        : (displays.find((d) => String(d.id) === source.display_id) ?? primary);
    // Thumbnails are fitted to thumbnailSize, so a display smaller than it comes back upscaled.
    scaleFactor = display.scaleFactor;
    const current = image.getSize();
    const native = fitWithin(current, getDisplayPixelSize(display));
    // Crop first, so only the area (not the whole screen) is ever resampled or encoded.
    if (request.kind === 'area' && request.area) {
      const rect = areaToImageRect(request.area, display.size, current);
      if (!rect) {
        throw new Error('The selected area is empty');
      }
      image = image.crop(rect);
    }
    if (native.width !== current.width || native.height !== current.height) {
      const cropped = image.getSize();
      image = image.resize({
        width: Math.max(1, Math.round((cropped.width * native.width) / current.width)),
        height: Math.max(1, Math.round((cropped.height * native.height) / current.height)),
        quality: 'best',
      });
    }
  }

  const size = image.getSize();
  return {
    kind: request.kind,
    png: image.toPNG(),
    width: size.width,
    height: size.height,
    scaleFactor,
    // A window source's name is its title: the page's title, for its window bar.
    ...(request.kind === 'window' && source.name && { windowTitle: source.name }),
  };
}

/** Crops a PNG to a rect in its own pixels (clamped to it). */
export function cropPng(
  png: Uint8Array,
  rect: { x: number; y: number; width: number; height: number },
): { png: Uint8Array; width: number; height: number } {
  const image = nativeImage.createFromBuffer(Buffer.from(png));
  const size = image.getSize();
  const x = Math.max(0, Math.min(size.width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(size.height - 1, Math.round(rect.y)));
  const width = Math.max(1, Math.min(size.width - x, Math.round(rect.width)));
  const height = Math.max(1, Math.min(size.height - y, Math.round(rect.height)));
  const cropped = image.crop({ x, y, width, height });
  return { png: cropped.toPNG(), width, height };
}

export async function copyImageToClipboard(png: Uint8Array): Promise<void> {
  // Renderer input: the bytes go to the clipboard as-is, so make sure they're a PNG.
  if (!isPng(png)) {
    throw new Error('Nothing to copy: not a PNG image');
  }
  // Electron 45's clipboard is the async ClipboardItem API (no writeImage).
  const blob = new Blob([new Uint8Array(png)], { type: 'image/png' });
  await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
