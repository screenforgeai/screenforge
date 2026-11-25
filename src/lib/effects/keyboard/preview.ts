import { invalidatePreview } from '../../pixi/previewInvalidation';

const PREVIEW_DURATION_MS = 2000;
let previewExpiresAt = 0;

export function triggerKeyboardPreview(): void {
  previewExpiresAt = Date.now() + PREVIEW_DURATION_MS;
  // The paused preview draws only after changes, so wake it to show the sample
  // and again once it has expired, to take it away.
  invalidatePreview();
  setTimeout(invalidatePreview, PREVIEW_DURATION_MS + 50);
}

export function isKeyboardPreviewActive(): boolean {
  return Date.now() < previewExpiresAt;
}
