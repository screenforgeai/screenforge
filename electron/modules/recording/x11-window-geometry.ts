/**
 * X11 window geometry lookup for window capture on Linux.
 *
 * desktopCapturer window source ids on X11 embed the X window id
 * ("window:39845892:0" → XID 39845892). xwininfo (x11-utils) resolves that id
 * to absolute screen coordinates without any native dependency; x11grab then
 * captures that region of the root window.
 */
import { execFile } from 'node:child_process';
import type { CaptureBounds } from './capture-args';

const XWININFO_TIMEOUT_MS = 2500;

export type FrameExtents = { left: number; right: number; top: number; bottom: number };

/** Parses `xwininfo -id <id>` output into absolute screen bounds. */
export function parseXwininfoGeometry(stdout: string): CaptureBounds | null {
  const x = /Absolute upper-left X:\s*(-?\d+)/.exec(stdout);
  const y = /Absolute upper-left Y:\s*(-?\d+)/.exec(stdout);
  const width = /Width:\s*(\d+)/.exec(stdout);
  const height = /Height:\s*(\d+)/.exec(stdout);

  if (!x || !y || !width || !height) {
    return null;
  }

  return {
    x: Number.parseInt(x[1], 10),
    y: Number.parseInt(y[1], 10),
    width: Number.parseInt(width[1], 10),
    height: Number.parseInt(height[1], 10),
  };
}

/**
 * Parses `xprop -id <id> _GTK_FRAME_EXTENTS` output. GTK client-side-decorated
 * windows reserve an invisible margin around the visible window for the shadow
 * — the X window is that much larger, and capturing it verbatim includes a
 * band of whatever is behind the window. Returns null when the property is
 * absent (non-GTK windows, maximized windows).
 */
export function parseGtkFrameExtents(stdout: string): FrameExtents | null {
  const match = /_GTK_FRAME_EXTENTS\(CARDINAL\)\s*=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/.exec(
    stdout,
  );
  if (!match) {
    return null;
  }

  return {
    left: Number.parseInt(match[1], 10),
    right: Number.parseInt(match[2], 10),
    top: Number.parseInt(match[3], 10),
    bottom: Number.parseInt(match[4], 10),
  };
}

/** Insets bounds by the shadow margin; ignores extents that would collapse it. */
export function applyFrameExtents(
  bounds: CaptureBounds,
  extents: FrameExtents | null,
): CaptureBounds {
  if (!extents) {
    return bounds;
  }

  const width = bounds.width - extents.left - extents.right;
  const height = bounds.height - extents.top - extents.bottom;
  if (width < 2 || height < 2) {
    return bounds;
  }

  return { x: bounds.x + extents.left, y: bounds.y + extents.top, width, height };
}

/** Best-effort _GTK_FRAME_EXTENTS lookup; resolves null on any failure. */
function getGtkFrameExtents(windowId: number): Promise<FrameExtents | null> {
  return new Promise((resolve) => {
    execFile(
      'xprop',
      ['-id', String(windowId), '_GTK_FRAME_EXTENTS'],
      { timeout: XWININFO_TIMEOUT_MS },
      (error, stdout) => {
        resolve(error ? null : parseGtkFrameExtents(stdout));
      },
    );
  });
}

export async function getX11WindowGeometry(windowId: number): Promise<CaptureBounds> {
  const [bounds, extents] = await Promise.all([
    getRawWindowGeometry(windowId),
    getGtkFrameExtents(windowId),
  ]);
  return applyFrameExtents(bounds, extents);
}

function getRawWindowGeometry(windowId: number): Promise<CaptureBounds> {
  return new Promise((resolve, reject) => {
    execFile(
      'xwininfo',
      ['-id', String(windowId)],
      { timeout: XWININFO_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(
              new Error(
                'Window recording requires the xwininfo utility. Install the x11-utils package and try again.',
              ),
            );
            return;
          }
          reject(new Error('Could not locate the selected window. It may have been closed.'));
          return;
        }

        const bounds = parseXwininfoGeometry(stdout);
        if (!bounds) {
          reject(new Error('Could not read the selected window bounds.'));
          return;
        }
        resolve(bounds);
      },
    );
  });
}
