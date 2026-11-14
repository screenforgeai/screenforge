/**
 * Wayland does not let an app list screens or other apps' windows: the user picks one in the
 * system share dialog (xdg-desktop-portal), which hands back just that one. These source ids
 * stand for "whatever the dialog returns".
 */
export const WAYLAND_PICKED_SCREEN_ID = 'screen:wayland';
export const WAYLAND_PICKED_WINDOW_ID = 'window:wayland';

type Size = { width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number };

/**
 * A selection drawn over a still shown fitted in the viewport (object-fit: contain), as a rect
 * in the still's own pixels. Only the part on the still counts; null when it misses the still.
 */
export function selectionToImageRect(selection: Rect, viewport: Size, image: Size): Rect | null {
  const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
  if (!(scale > 0)) {
    return null;
  }
  const offsetX = (viewport.width - image.width * scale) / 2;
  const offsetY = (viewport.height - image.height * scale) / 2;
  const left = Math.max(0, Math.round((selection.x - offsetX) / scale));
  const top = Math.max(0, Math.round((selection.y - offsetY) / scale));
  const right = Math.min(
    image.width,
    Math.round((selection.x + selection.width - offsetX) / scale),
  );
  const bottom = Math.min(
    image.height,
    Math.round((selection.y + selection.height - offsetY) / scale),
  );
  if (right - left < 1 || bottom - top < 1) {
    return null;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
