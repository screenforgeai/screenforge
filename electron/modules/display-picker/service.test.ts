// @vitest-environment node

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisplayInfo } from '../../../src/types/index';

type FakeWindow = EventEmitter & {
  options: { x: number; y: number; width: number; height: number };
  webContents: { id: number };
  closed: boolean;
  isDestroyed: () => boolean;
  close: () => void;
  show: ReturnType<typeof vi.fn>;
  showInactive: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
  getBounds: ReturnType<typeof vi.fn>;
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
};

const state = vi.hoisted(() => ({
  windows: [] as FakeWindow[],
  nextId: 1,
  screen: null as unknown as EventEmitter & Record<string, unknown>,
  displays: [] as DisplayInfo[],
}));

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  const screenEmitter = Object.assign(new Emitter(), {
    getAllDisplays: vi.fn(),
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(),
  });
  state.screen = screenEmitter;
  class BrowserWindow extends Emitter {
    options: unknown;
    webContents = { id: state.nextId++ };
    closed = false;
    show = vi.fn();
    showInactive = vi.fn();
    focus = vi.fn();
    bounds: unknown;
    setBounds = vi.fn((bounds: unknown) => {
      this.bounds = bounds;
    });
    getBounds = vi.fn(() => this.bounds);
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
  return { BrowserWindow, screen: screenEmitter };
});

vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/workspace-pin', () => ({ pinWindowToAllWorkspaces: vi.fn() }));
const focusOverlay = vi.hoisted(() => vi.fn());
vi.mock('../../lib/focus-overlay', () => ({ focusOverlay }));
vi.mock('../sources/service', () => ({ getDisplays: () => state.displays }));

const { cancelDisplayPick, confirmDisplayPick, getDisplayPickerTarget, openDisplayPicker } =
  await import('./service');

// The external monitor sits above-left of the laptop, which is the main display.
const laptop: DisplayInfo = {
  id: 1,
  label: 'Built-in Retina Display',
  width: 1680,
  height: 1050,
  isPrimary: true,
};
const external: DisplayInfo = {
  id: 2,
  label: 'BenQ GW2785TC',
  width: 1920,
  height: 1080,
  isPrimary: false,
};
const bounds = {
  1: { x: 0, y: 0, width: 1680, height: 1050 },
  2: { x: -675, y: -1080, width: 1920, height: 1080 },
};

const loadURL = vi.fn();
const open = (purpose: 'record' | 'screenshot' = 'record') =>
  openDisplayPicker('/preload.js', loadURL, purpose);
const overlayOf = (display: DisplayInfo) =>
  state.windows.find((win) => win.options.x === bounds[display.id as 1 | 2].x) as FakeWindow;

describe('display picker', () => {
  beforeEach(() => {
    cancelDisplayPick();
    focusOverlay.mockClear();
    state.windows = [];
    state.displays = [laptop, external];
    loadURL.mockClear();
    const screen = state.screen as unknown as {
      getAllDisplays: ReturnType<typeof vi.fn>;
      getDisplayNearestPoint: ReturnType<typeof vi.fn>;
    };
    screen.getAllDisplays.mockReturnValue([
      { id: 1, bounds: bounds[1] },
      { id: 2, bounds: bounds[2] },
    ]);
    screen.getDisplayNearestPoint.mockReturnValue({ id: 2 });
  });

  it('covers each monitor with an overlay at its bounds', () => {
    void open();

    expect(state.windows.map((win) => win.options)).toEqual([
      expect.objectContaining(bounds[1]),
      expect.objectContaining(bounds[2]),
    ]);
    expect(loadURL).toHaveBeenCalledTimes(2);
    expect(loadURL).toHaveBeenCalledWith(expect.anything(), 'display-picker');
  });

  it('gives the keyboard to the overlay under the cursor', () => {
    void open();
    overlayOf(laptop).emit('ready-to-show');
    overlayOf(external).emit('ready-to-show');

    expect(focusOverlay).toHaveBeenCalledTimes(1);
    expect(focusOverlay).toHaveBeenCalledWith(overlayOf(external));
    expect(overlayOf(laptop).showInactive).toHaveBeenCalled();
  });

  it('puts each overlay back on its own monitor once shown (macOS may move it)', () => {
    void open();
    const overlay = overlayOf(laptop);
    overlay.setBounds.mockClear();
    overlay.emit('ready-to-show');

    expect(overlay.show.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      overlay.setBounds.mock.invocationCallOrder[0] ?? 0,
    );
    expect(overlay.setBounds).toHaveBeenCalledWith(bounds[1]);
    expect(overlay.options).toEqual(expect.objectContaining({ enableLargerThanScreen: true }));
  });

  it('tells each overlay which monitor it covers, numbered in OS order', () => {
    void open('screenshot');

    expect(getDisplayPickerTarget(overlayOf(laptop).webContents.id)).toEqual({
      display: laptop,
      number: 1,
      count: 2,
      purpose: 'screenshot',
    });
    expect(getDisplayPickerTarget(overlayOf(external).webContents.id)).toEqual({
      display: external,
      number: 2,
      count: 2,
      purpose: 'screenshot',
    });
    expect(getDisplayPickerTarget(999)).toBeNull();
  });

  it('picks the monitor whose overlay was clicked and closes every overlay', async () => {
    const picked = open();
    confirmDisplayPick(overlayOf(external).webContents.id);

    await expect(picked).resolves.toBe(2);
    expect(state.windows.every((win) => win.closed)).toBe(true);
  });

  it('picks a monitor by its number from any overlay', async () => {
    const picked = open();
    confirmDisplayPick(overlayOf(external).webContents.id, 1);

    await expect(picked).resolves.toBe(1);
  });

  it('picks nothing when cancelled, or when an overlay is closed from outside', async () => {
    const first = open();
    cancelDisplayPick();
    await expect(first).resolves.toBeNull();

    const second = open();
    state.windows.at(-1)?.close();
    await expect(second).resolves.toBeNull();
    expect(state.windows.every((win) => win.closed)).toBe(true);
  });

  it('cancels when a monitor is plugged in or out while picking', async () => {
    const picked = open();
    state.screen.emit('display-removed', { id: 2 });

    await expect(picked).resolves.toBeNull();
    expect(state.windows.every((win) => win.closed)).toBe(true);
    expect(state.screen.listenerCount('display-removed')).toBe(0);
    expect(state.screen.listenerCount('display-added')).toBe(0);
  });

  it('does not open twice', async () => {
    void open();
    await expect(open()).resolves.toBeNull();
    expect(state.windows).toHaveLength(2);
  });
});
