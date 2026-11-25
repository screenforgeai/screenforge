// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

const appFocus = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ app: { focus: appFocus } }));

const { focusOverlay } = await import('./focus-overlay');

const originalPlatform = process.platform;
const setPlatform = (value: string) =>
  Object.defineProperty(process, 'platform', { configurable: true, value });
const fakeWindow = (destroyed = false) => ({
  isDestroyed: () => destroyed,
  focus: vi.fn(),
});

describe('focusOverlay', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
    appFocus.mockClear();
  });

  it('brings Screenforge forward on macOS, so keys reach the overlay', () => {
    setPlatform('darwin');
    const win = fakeWindow();
    focusOverlay(win as never);

    expect(appFocus).toHaveBeenCalledWith({ steal: true });
    expect(win.focus).toHaveBeenCalled();
  });

  it('only focuses the window elsewhere', () => {
    setPlatform('win32');
    const win = fakeWindow();
    focusOverlay(win as never);

    expect(appFocus).not.toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  it('leaves a closed window alone', () => {
    setPlatform('darwin');
    const win = fakeWindow(true);
    focusOverlay(win as never);

    expect(appFocus).not.toHaveBeenCalled();
    expect(win.focus).not.toHaveBeenCalled();
  });
});
