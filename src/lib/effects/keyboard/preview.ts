const PREVIEW_DURATION_MS = 2000;
let previewExpiresAt = 0;

export function triggerKeyboardPreview(): void {
  previewExpiresAt = Date.now() + PREVIEW_DURATION_MS;
}

export function isKeyboardPreviewActive(): boolean {
  return Date.now() < previewExpiresAt;
}
