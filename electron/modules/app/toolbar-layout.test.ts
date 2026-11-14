import { describe, expect, it } from 'vitest';
import { getToolbarLayout, getToolbarWindowSize } from './toolbar-layout';

describe('getToolbarLayout', () => {
  it('keeps the full-screen overlay on macOS, Windows and X11', () => {
    expect(getToolbarLayout({ platform: 'darwin', waylandSession: false })).toBe('overlay');
    expect(getToolbarLayout({ platform: 'win32', waylandSession: false })).toBe('overlay');
    expect(getToolbarLayout({ platform: 'linux', waylandSession: false })).toBe('overlay');
  });

  it('on native Wayland, uses a window that is just the toolbar', () => {
    // Wayland places windows itself and does not pass clicks through a transparent one, so a
    // full-screen overlay landed on one monitor and blocked every click on it.
    expect(getToolbarLayout({ platform: 'linux', waylandSession: true })).toBe('window');
  });

  it('keeps the overlay when the app runs under XWayland', () => {
    expect(
      getToolbarLayout({ platform: 'linux', waylandSession: true, ozonePlatform: 'x11' }),
    ).toBe('overlay');
  });
});

describe('getToolbarWindowSize', () => {
  it('covers the whole work area as an overlay', () => {
    expect(getToolbarWindowSize('overlay', { width: 2560, height: 1440 })).toEqual({
      width: 2560,
      height: 1440,
    });
  });

  it('starts at the toolbar size as a window; the toolbar then fits it to its content', () => {
    expect(getToolbarWindowSize('window', { width: 2560, height: 1440 })).toEqual({
      width: 760,
      height: 84,
    });
  });
});
