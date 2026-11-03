import type { BrowserWindow, Rectangle } from 'electron';
import type { ToolbarShapeRect } from '../../../src/types';

// The toolbar is a full-screen transparent window that must let clicks fall
// through everywhere except the toolbar UI itself.
//
// macOS/Windows: setIgnoreMouseEvents(true, { forward: true }) — the window is
// click-through but mouse-move events are still forwarded to the page, so the
// renderer can detect hover over the toolbar and re-enable interactivity.
//
// Linux: the `forward` option is not supported, so a click-through window
// receives no mouse events at all and hover detection can never fire. Instead,
// the window keeps input enabled and its X11 shape region (setShape) is
// restricted to the toolbar rects reported by the renderer — input and drawing
// outside the shape fall through to whatever is behind the window. Real mouse
// events arrive inside the shape, so the renderer's hover detection works: on
// hover the shape expands to the full window (mirroring the "interactive"
// state on macOS/Windows), and shrinks back when the cursor leaves. The shape
// is never changed mid-pointer-gesture — an X11 input-region change during an
// active implicit grab can swallow the pointer-up and wedge pointer capture.
// This works on both X11 and Wayland (via XWayland's input-region translation).

const isLinux = process.platform === 'linux';

// Effectively click-through until the renderer reports real toolbar rects.
const PASSTHROUGH_SHAPE: Rectangle[] = [{ x: 0, y: 0, width: 1, height: 1 }];

let lastShapeRects: Rectangle[] = PASSTHROUGH_SHAPE;
let toolbarInteractive = false;

function fullWindowShape(window: BrowserWindow): Rectangle[] {
  const { width, height } = window.getBounds();
  return [{ x: 0, y: 0, width, height }];
}

function sanitizeRects(rects: ToolbarShapeRect[]): Rectangle[] {
  return rects
    .map((rect) => ({
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

/**
 * A newly created toolbar window has a fresh renderer that re-reports its
 * rects from scratch — drop anything a previous window left behind. Not for
 * re-shows of an existing window: its renderer only re-sends on change.
 */
export function resetToolbarShapeState(): void {
  lastShapeRects = PASSTHROUGH_SHAPE;
  toolbarInteractive = false;
}

/** Initial state for a newly created or re-shown toolbar window: click-through. */
export function resetToolbarMousePassthrough(window: BrowserWindow): void {
  if (isLinux) {
    toolbarInteractive = false;
    window.setShape(lastShapeRects);
    return;
  }

  window.setIgnoreMouseEvents(true, { forward: true });
}

export function setToolbarMouseInteractivity(window: BrowserWindow, interactive: boolean): void {
  if (isLinux) {
    toolbarInteractive = interactive;
    window.setShape(interactive ? fullWindowShape(window) : lastShapeRects);
    return;
  }

  window.setIgnoreMouseEvents(!interactive, interactive ? undefined : { forward: true });
}

/**
 * Linux only: record the toolbar region reported by the renderer. Applied
 * immediately when the window is in its shrunken (non-interactive) state;
 * while interactive (hovered/dragging/menus open) the full-window shape stays
 * in place and the new rects take effect on the next hover-out.
 */
export function setToolbarShape(window: BrowserWindow, rects: ToolbarShapeRect[]): void {
  if (!isLinux) {
    return;
  }

  const sanitized = sanitizeRects(rects);
  lastShapeRects = sanitized.length > 0 ? sanitized : PASSTHROUGH_SHAPE;

  if (!toolbarInteractive) {
    window.setShape(lastShapeRects);
  }
}
