// @vitest-environment node

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeWindow = EventEmitter & {
  options: { x: number; y: number; width: number; height: number };
  webContents: EventEmitter;
  close: () => void;
};

const state = vi.hoisted(() => ({
  windows: [] as FakeWindow[],
  displays: [] as Array<{ id: number; bounds: Record<string, number>; workArea: unknown }>,
  primaryId: 1,
}));
const focusOverlay = vi.hoisted(() => vi.fn());

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class BrowserWindow extends Emitter {
    options: unknown;
    webContents = new Emitter();
    closed = false;
    setBounds = vi.fn();
    getBounds = vi.fn(() => ({}));
    getContentSize = vi.fn(() => [0, 0]);
    setAlwaysOnTop = vi.fn();
    constructor(options: unknown) {
      super();
      this.options = options;
      state.windows.push(this as unknown as FakeWindow);
    }
    isDestroyed() {
      return this.closed;
    }
    close() {
      this.closed = true;
      this.emit('closed');
    }
  }
  return {
    BrowserWindow,
    screen: {
      getAllDisplays: () => state.displays,
      getPrimaryDisplay: () => state.displays.find((d) => d.id === state.primaryId),
    },
  };
});
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/workspace-pin', () => ({ pinWindowToAllWorkspaces: vi.fn() }));
vi.mock('../../lib/focus-overlay', () => ({ focusOverlay }));

const { cancelAreaSelection, confirmAreaSelection, openAreaSelector } = await import('./service');

const laptop = { id: 1, bounds: { x: 0, y: 0, width: 1680, height: 1050 }, workArea: {} };
const external = {
  id: 2,
  bounds: { x: -675, y: -1080, width: 1920, height: 1080 },
  workArea: {},
};
const loadURL = vi.fn();

describe('area selector', () => {
  beforeEach(() => {
    cancelAreaSelection();
    state.windows = [];
    state.displays = [laptop, external];
    focusOverlay.mockClear();
  });

  it('opens on the main display by default', () => {
    void openAreaSelector('/preload.js', loadURL, 'screenshot');

    expect(state.windows[0]?.options).toEqual(expect.objectContaining(laptop.bounds));
  });

  it('opens on the display picked for it, and the area belongs to that display', async () => {
    const selected = openAreaSelector('/preload.js', loadURL, 'record', external.id);
    expect(state.windows[0]?.options).toEqual(expect.objectContaining(external.bounds));

    confirmAreaSelection({ x: 10, y: 20, width: 300, height: 200 });
    await expect(selected).resolves.toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
      display: { id: external.id, width: 1920, height: 1080 },
    });
  });

  it('falls back to the main display when the picked one is gone', () => {
    void openAreaSelector('/preload.js', loadURL, 'record', 99);

    expect(state.windows[0]?.options).toEqual(expect.objectContaining(laptop.bounds));
  });

  it('takes the keyboard once loaded, so Esc reaches it', () => {
    void openAreaSelector('/preload.js', loadURL, 'screenshot');
    state.windows[0]?.webContents.emit('did-finish-load');

    expect(focusOverlay).toHaveBeenCalledWith(state.windows[0]);
  });
});
