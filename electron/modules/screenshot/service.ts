import { ClipboardItem, clipboard, desktopCapturer, nativeImage, screen } from 'electron';
import type { ScreenshotCapture, ScreenshotCaptureRequest } from '../../../src/types/index';
import {
  areaToImageRect,
  fitWithin,
  getCaptureThumbnailSize,
  getDisplayPixelSize,
  pickSourceForCapture,
} from './capture-geometry';

/**
 * Grabs a single still for a display, a window or an area of the primary
 * display. desktopCapturer thumbnails are real screen grabs, so asking for one
 * at native resolution avoids starting a capture stream for a single frame.
 */
export async function captureStill(request: ScreenshotCaptureRequest): Promise<ScreenshotCapture> {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: request.kind === 'window' ? ['window'] : ['screen'],
    thumbnailSize: getCaptureThumbnailSize(displays),
    fetchWindowIcons: false,
  });

  const source = pickSourceForCapture(sources, request, { primary, all: displays }, (s) =>
    s.thumbnail.getSize(),
  );
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error(`No image available for ${request.kind} capture (${request.sourceId})`);
  }

  let image = source.thumbnail;
  if (request.kind !== 'window') {
    const display = displays.find((d) => String(d.id) === source.display_id) ?? primary;
    // Thumbnails are fitted to the largest display, so a smaller one comes back upscaled.
    const current = image.getSize();
    const target = fitWithin(current, getDisplayPixelSize(display));
    if (target.width !== current.width || target.height !== current.height) {
      image = image.resize({ ...target, quality: 'best' });
    }
    if (request.kind === 'area') {
      if (!request.area) {
        throw new Error('Area capture requested without an area');
      }
      const rect = areaToImageRect(request.area, display.size, image.getSize());
      if (!rect) {
        throw new Error('The selected area is empty');
      }
      image = image.crop(rect);
    }
  }

  const size = image.getSize();
  return { kind: request.kind, dataUrl: image.toDataURL(), width: size.width, height: size.height };
}

export async function copyImageToClipboard(dataUrl: string): Promise<void> {
  // Decoding through nativeImage validates the data and guarantees PNG bytes.
  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) {
    throw new Error('Nothing to copy: the image is empty');
  }
  // Electron 45's clipboard is the async ClipboardItem API (no writeImage).
  const png = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' });
  await clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
