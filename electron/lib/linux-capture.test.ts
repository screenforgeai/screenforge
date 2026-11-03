// @vitest-environment node

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLinuxCaptureBackend, getLinuxSessionType, isWaylandSession } from './linux-capture';

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
}

const SESSION_ENV_KEYS = ['XDG_SESSION_TYPE', 'WAYLAND_DISPLAY', 'DISPLAY'] as const;
const savedEnv: Partial<Record<(typeof SESSION_ENV_KEYS)[number], string | undefined>> = {};

describe('linux-capture session detection', () => {
  beforeEach(() => {
    for (const key of SESSION_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    setPlatform('linux');
  });

  afterEach(() => {
    for (const key of SESSION_ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  afterAll(() => {
    setPlatform(originalPlatform);
  });

  it('detects a Wayland session via XDG_SESSION_TYPE', () => {
    process.env.XDG_SESSION_TYPE = 'wayland';
    expect(getLinuxSessionType()).toBe('wayland');
    expect(isWaylandSession()).toBe(true);
    expect(getLinuxCaptureBackend()).toBe('wayland-portal');
  });

  it('detects a Wayland session via WAYLAND_DISPLAY', () => {
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    expect(getLinuxSessionType()).toBe('wayland');
    expect(getLinuxCaptureBackend()).toBe('wayland-portal');
  });

  it('treats XWayland (DISPLAY set inside a Wayland session) as Wayland, not X11', () => {
    // XWayland sessions expose both — x11grab would record a black screen.
    process.env.XDG_SESSION_TYPE = 'wayland';
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    process.env.DISPLAY = ':0';
    expect(getLinuxSessionType()).toBe('wayland');
    expect(getLinuxCaptureBackend()).toBe('wayland-portal');
  });

  it('detects an X11 session via XDG_SESSION_TYPE', () => {
    process.env.XDG_SESSION_TYPE = 'x11';
    expect(getLinuxSessionType()).toBe('x11');
    expect(isWaylandSession()).toBe(false);
    expect(getLinuxCaptureBackend()).toBe('ffmpeg-x11');
  });

  it('falls back to DISPLAY when XDG_SESSION_TYPE is absent', () => {
    process.env.DISPLAY = ':99';
    expect(getLinuxSessionType()).toBe('x11');
    expect(getLinuxCaptureBackend()).toBe('ffmpeg-x11');
  });

  it('normalizes XDG_SESSION_TYPE casing and whitespace', () => {
    process.env.XDG_SESSION_TYPE = '  Wayland ';
    expect(getLinuxSessionType()).toBe('wayland');
  });

  it('reports unknown when no display environment is present', () => {
    expect(getLinuxSessionType()).toBe('unknown');
    expect(isWaylandSession()).toBe(false);
    expect(getLinuxCaptureBackend()).toBe('unsupported');
  });

  it('ignores an unrecognized XDG_SESSION_TYPE (e.g. tty) without DISPLAY', () => {
    process.env.XDG_SESSION_TYPE = 'tty';
    expect(getLinuxSessionType()).toBe('unknown');
    expect(getLinuxCaptureBackend()).toBe('unsupported');
  });

  it('never reports a Linux session type on other platforms', () => {
    setPlatform('darwin');
    process.env.XDG_SESSION_TYPE = 'wayland';
    process.env.DISPLAY = ':0';
    expect(getLinuxSessionType()).toBe('unknown');
    expect(isWaylandSession()).toBe(false);
  });
});
