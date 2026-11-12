import { CH } from '../../channels';
import { handleChannel } from '../../lib/ipc-main';
import type { ScreenshotCaptureRequest } from '../../../src/types/index';
import { captureAndOpenEditor, type ScreenshotWindows } from './flow';
import { copyImageToClipboard } from './service';

const CAPTURE_KINDS = new Set(['display', 'window', 'area']);

// Renderer input: the request type is not enforced at runtime.
function isValidCaptureRequest(request: unknown): request is ScreenshotCaptureRequest {
  const r = request as Partial<ScreenshotCaptureRequest> | null;
  if (!r || typeof r.sourceId !== 'string' || !CAPTURE_KINDS.has(r.kind as string)) {
    return false;
  }
  if (r.kind !== 'area') {
    return true;
  }
  const a = r.area;
  if (
    !a ||
    ![a.x, a.y, a.width, a.height].every(Number.isFinite) ||
    a.width <= 0 ||
    a.height <= 0
  ) {
    return false;
  }
  const d = a.display;
  return (
    d === undefined ||
    (!!d &&
      [d.id, d.width, d.height].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
      d.width > 0 &&
      d.height > 0)
  );
}

export function registerScreenshotChannels(windows: ScreenshotWindows): void {
  handleChannel<[ScreenshotCaptureRequest], void>(CH.screenshot.CAPTURE, async (request) => {
    if (!isValidCaptureRequest(request)) {
      throw new Error('Invalid screenshot capture request');
    }
    await captureAndOpenEditor(request, windows);
  });

  handleChannel<[Uint8Array], void>(CH.screenshot.COPY, (png) => copyImageToClipboard(png));
}
