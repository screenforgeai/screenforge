import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { CH } from '../../channels';
import type { ToolbarLayout } from '../../../src/types';
import { registerWindowChannels } from './window-controller';

const ipc = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
const mouse = vi.hoisted(() => ({
  setToolbarMouseInteractivity: vi.fn(),
  setToolbarShape: vi.fn(),
}));

vi.mock('electron', () => ({ app: { dock: undefined } }));
vi.mock('../../lib/ipc-main', () => ({
  listenChannel: (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipc.listeners.set(channel, fn),
  handleChannel: (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipc.handlers.set(channel, fn),
}));
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../recording/utils/tray', () => ({
  destroyRecordingTray: vi.fn(),
  startRecordingTray: vi.fn(),
}));
vi.mock('../camera-preview/service', () => ({ closeCameraPreview: vi.fn() }));
vi.mock('./toolbar-mouse', () => mouse);

const fakeToolbar = () =>
  ({
    show: vi.fn(),
    focus: vi.fn(),
    getContentSize: vi.fn(() => [760, 84]),
    setContentSize: vi.fn(),
    getBounds: vi.fn(() => ({ x: 0, y: 0, width: 760, height: 84 })),
    setBounds: vi.fn(),
  }) as unknown as BrowserWindow & {
    setContentSize: ReturnType<typeof vi.fn>;
  };

const setup = (layout: ToolbarLayout) => {
  ipc.listeners.clear();
  ipc.handlers.clear();
  const toolbar = fakeToolbar();
  registerWindowChannels({
    getMainWindow: () => null,
    getToolbarWindow: () => toolbar,
    setToolbarWindow: vi.fn(),
    createToolbarWindow: vi.fn(),
    getToolbarLayout: () => layout,
  });
  const send = (channel: string, ...args: unknown[]) => ipc.listeners.get(channel)?.(...args);
  return { toolbar, send };
};

describe('toolbar window channels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('as an overlay (macOS, Windows, X11): click-through as before, and never resized', () => {
    const { toolbar, send } = setup('overlay');
    send(CH.app.SET_TOOLBAR_MOUSE_INTERACTIVITY, true);
    send(CH.app.SET_TOOLBAR_SHAPE, [{ x: 0, y: 0, width: 10, height: 10 }]);
    send(CH.app.SHOW_TOOLBAR);
    send(CH.app.SET_TOOLBAR_SIZE, { width: 700, height: 300 });

    expect(mouse.setToolbarMouseInteractivity).toHaveBeenCalledWith(toolbar, true);
    expect(mouse.setToolbarMouseInteractivity).toHaveBeenCalledWith(toolbar, false);
    expect(mouse.setToolbarShape).toHaveBeenCalled();
    expect(toolbar.setContentSize).not.toHaveBeenCalled();
    expect(ipc.handlers.get(CH.app.GET_TOOLBAR_LAYOUT)?.()).toBe('overlay');
  });

  it('as a window (native Wayland): sized to its content, with no click-through to manage', () => {
    const { toolbar, send } = setup('window');
    send(CH.app.SET_TOOLBAR_MOUSE_INTERACTIVITY, true);
    send(CH.app.SET_TOOLBAR_SHAPE, [{ x: 0, y: 0, width: 10, height: 10 }]);
    send(CH.app.SHOW_TOOLBAR);
    send(CH.app.SET_TOOLBAR_SIZE, { width: 700.4, height: 300 });

    expect(mouse.setToolbarMouseInteractivity).not.toHaveBeenCalled();
    expect(mouse.setToolbarShape).not.toHaveBeenCalled();
    expect(toolbar.setContentSize).toHaveBeenCalledWith(700, 300);
    expect(ipc.handlers.get(CH.app.GET_TOOLBAR_LAYOUT)?.()).toBe('window');
  });
});
