import type { ToolbarLayout } from '../../../src/types';
import { TOOLBAR_COMPACT_H, TOOLBAR_W } from '../../../src/lib/toolbarViewport';

type LayoutInput = {
  platform: NodeJS.Platform;
  /** The desktop session is Wayland (XDG_SESSION_TYPE / WAYLAND_DISPLAY). */
  waylandSession: boolean;
  /** Electron's --ozone-platform switch, if given. */
  ozonePlatform?: string;
  /** ELECTRON_OZONE_PLATFORM_HINT, if set. */
  ozonePlatformHint?: string;
};

/**
 * How the floating toolbar's window is laid out.
 *
 * - 'overlay': a transparent window over the whole screen that lets clicks through everywhere
 *   but the toolbar (macOS and Windows ignore mouse events outside it; X11 shapes its input
 *   region). The toolbar is dragged around inside it.
 * - 'window': a window that is just the toolbar, moved by its drag handle. Native Wayland
 *   neither lets an app place its windows nor passes clicks through a transparent one, so an
 *   overlay there landed on whichever monitor the compositor chose and blocked every click on it.
 *
 * Under XWayland (the app started with --ozone-platform=x11) the X11 overlay works.
 */
export function getToolbarLayout({
  platform,
  waylandSession,
  ozonePlatform,
  ozonePlatformHint,
}: LayoutInput): ToolbarLayout {
  if (platform !== 'linux' || !waylandSession) {
    return 'overlay';
  }
  if (ozonePlatform === 'x11' || (!ozonePlatform && ozonePlatformHint === 'x11')) {
    return 'overlay';
  }
  return 'window';
}

/** The toolbar window's size when it is created. */
export function getToolbarWindowSize(
  layout: ToolbarLayout,
  workArea: { width: number; height: number },
): { width: number; height: number } {
  return layout === 'overlay'
    ? { width: workArea.width, height: workArea.height }
    : { width: TOOLBAR_W, height: TOOLBAR_COMPACT_H };
}
