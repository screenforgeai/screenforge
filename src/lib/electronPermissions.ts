const ALLOWED_RENDERER_PERMISSIONS = new Set([
  'media',
  'audioCapture',
  'microphone',
  'camera',
  'videoCapture',
  // Wayland (Linux): the toolbar records the screen itself via
  // getDisplayMedia, which Chromium gates behind this permission. The actual
  // consent flow is the OS portal dialog, so auto-granting here is safe.
  'display-capture',
]);

export function isAllowedRendererPermission(permission: string): boolean {
  return ALLOWED_RENDERER_PERMISSIONS.has(permission);
}
