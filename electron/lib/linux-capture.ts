/**
 * Linux display-session detection and capture-backend selection.
 *
 * Linux has two display systems with fundamentally different recording rules:
 * - X11: FFmpeg can grab the screen directly (x11grab) and uiohook-napi can
 *   install global input hooks.
 * - Wayland: direct grabbing is forbidden. Capture must go through
 *   PipeWire + xdg-desktop-portal, which Chromium exposes via getDisplayMedia,
 *   so the renderer records the portal stream with MediaRecorder instead.
 *
 * Note: most Wayland sessions run XWayland, so DISPLAY being set does NOT
 * imply X11 — x11grab under XWayland records a black/empty screen. Session
 * type must be checked before DISPLAY.
 */

import type { CaptureBackend } from '../../src/types/index';

export type LinuxSessionType = 'x11' | 'wayland' | 'unknown';

export type { CaptureBackend };

export function getLinuxSessionType(): LinuxSessionType {
  if (process.platform !== 'linux') {
    return 'unknown';
  }

  const sessionType = process.env.XDG_SESSION_TYPE?.trim().toLowerCase();
  if (sessionType === 'wayland' || process.env.WAYLAND_DISPLAY) {
    return 'wayland';
  }
  if (sessionType === 'x11' || process.env.DISPLAY) {
    return 'x11';
  }

  return 'unknown';
}

export function isWaylandSession(): boolean {
  return getLinuxSessionType() === 'wayland';
}

export function getLinuxCaptureBackend(): CaptureBackend {
  switch (getLinuxSessionType()) {
    case 'wayland':
      return 'wayland-portal';
    case 'x11':
      return 'ffmpeg-x11';
    default:
      return 'unsupported';
  }
}
