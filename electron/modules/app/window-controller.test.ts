import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { CH } from '../../channels';
import type { RecordingResult, ToolbarLayout } from '../../../src/types';
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
const appService = vi.hoisted(() => ({ showSystemWarning: vi.fn() }));
vi.mock('./service', () => appService);

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
    stopRecovery: { recover: vi.fn(), reset: vi.fn() },
  });
  const send = (channel: string, ...args: unknown[]) => ipc.listeners.get(channel)?.(...args);
  return { toolbar, send };
};

/** A toolbar window whose renderer can crash and which can be closed. */
const crashableToolbar = () => {
  const win = new EventEmitter() as EventEmitter & {
    webContents: EventEmitter & { send: ReturnType<typeof vi.fn> };
    hide: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    isDestroyed: () => boolean;
    destroyed: boolean;
  };
  win.webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
  win.destroyed = false;
  win.isDestroyed = () => win.destroyed;
  win.hide = vi.fn();
  win.destroy = vi.fn(() => {
    win.destroyed = true;
    win.emit('closed');
  });
  win.close = vi.fn(() => win.destroy());
  return win;
};

const recording: RecordingResult = {
  filePath: '/tmp/screen.mp4',
  mouseData: [],
  duration: 3600,
  startTime: 1,
  recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

const setupProcessing = (recover: () => Promise<RecordingResult | null>) => {
  ipc.listeners.clear();
  ipc.handlers.clear();
  const crashedToolbar = crashableToolbar();
  let toolbar: ReturnType<typeof crashableToolbar> | null = crashedToolbar;
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { send: vi.fn() },
    show: vi.fn(),
    focus: vi.fn(),
  };
  const stopRecovery = { recover: vi.fn(recover), reset: vi.fn() };
  const setToolbarWindow = vi.fn((win: unknown) => {
    toolbar = win as typeof toolbar;
  });
  registerWindowChannels({
    getMainWindow: () => mainWindow as unknown as BrowserWindow,
    getToolbarWindow: () => toolbar as unknown as BrowserWindow,
    setToolbarWindow,
    createToolbarWindow: vi.fn(),
    getToolbarLayout: () => 'overlay',
    stopRecovery,
  });
  const send = (channel: string, ...args: unknown[]) => ipc.listeners.get(channel)?.(...args);
  const sentToEditor = (channel: string) =>
    mainWindow.webContents.send.mock.calls.filter(([sent]) => sent === channel);
  return { toolbar: crashedToolbar, send, stopRecovery, sentToEditor, setToolbarWindow };
};

describe('toolbar lost while the recording is saving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the screen recording in the editor when the toolbar renderer crashes', async () => {
    const { toolbar, send, stopRecovery, sentToEditor, setToolbarWindow } = setupProcessing(
      async () => recording,
    );
    send(CH.recording.PROCESSING);

    toolbar.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: 1 });

    await vi.waitFor(() =>
      expect(sentToEditor(CH.recording.LOAD)).toEqual([[CH.recording.LOAD, recording]]),
    );
    expect(sentToEditor(CH.recording.FAILED)).toEqual([]);
    expect(toolbar.destroy).toHaveBeenCalled();
    expect(setToolbarWindow).toHaveBeenCalledWith(null);
    expect(stopRecovery.reset).toHaveBeenCalled();
    // Mic and camera were in the toolbar: say they are missing.
    expect(appService.showSystemWarning).toHaveBeenCalledTimes(1);
  });

  it('also recovers when the toolbar window is closed mid-save', async () => {
    const { toolbar, send, sentToEditor } = setupProcessing(async () => recording);
    send(CH.recording.PROCESSING);

    toolbar.emit('closed');

    await vi.waitFor(() => expect(sentToEditor(CH.recording.LOAD)).toHaveLength(1));
  });

  it('tells the editor the recording failed when there is nothing to recover', async () => {
    const { toolbar, send, sentToEditor } = setupProcessing(async () => null);
    send(CH.recording.PROCESSING);

    toolbar.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });

    await vi.waitFor(() => expect(sentToEditor(CH.recording.FAILED)).toHaveLength(1));
    expect(sentToEditor(CH.recording.LOAD)).toEqual([]);
  });

  it('tells the editor the recording failed when finishing the capture fails', async () => {
    const { toolbar, send, sentToEditor } = setupProcessing(async () => {
      throw new Error('nothing was captured');
    });
    send(CH.recording.PROCESSING);

    toolbar.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });

    await vi.waitFor(() =>
      expect(sentToEditor(CH.recording.FAILED)).toEqual([
        [CH.recording.FAILED, expect.stringContaining('nothing was captured')],
      ]),
    );
  });

  it('does nothing extra when the toolbar finishes normally and closes', async () => {
    const { toolbar, send, stopRecovery, sentToEditor } = setupProcessing(async () => recording);
    send(CH.recording.PROCESSING);

    send(CH.recording.FINISHED, recording);
    toolbar.emit('closed');
    await Promise.resolve();

    expect(stopRecovery.recover).not.toHaveBeenCalled();
    expect(stopRecovery.reset).toHaveBeenCalled();
    expect(sentToEditor(CH.recording.LOAD)).toEqual([[CH.recording.LOAD, recording]]);
  });

  it('does nothing when the toolbar crashes outside a save', async () => {
    const { toolbar, stopRecovery, sentToEditor } = setupProcessing(async () => recording);

    toolbar.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    await Promise.resolve();

    expect(stopRecovery.recover).not.toHaveBeenCalled();
    expect(sentToEditor(CH.recording.LOAD)).toEqual([]);
  });
});

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
