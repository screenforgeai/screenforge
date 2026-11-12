// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CH } from '../../channels';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
const serviceMock = vi.hoisted(() => ({
  captureStill: vi.fn(),
  copyImageToClipboard: vi.fn(),
}));

vi.mock('../../lib/ipc-main', () => ({
  handleChannel: (channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  },
}));
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../camera-preview/service', () => ({ closeCameraPreview: vi.fn() }));
vi.mock('./service', () => serviceMock);

import { registerScreenshotChannels } from './channel';

const capture = { kind: 'display', png: new Uint8Array([1, 2, 3]), width: 10, height: 10 };

function makeWindow(destroyed = false) {
  return {
    hide: vi.fn(),
    show: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    webContents: { send: vi.fn() },
  };
}

function register(mainWindow: ReturnType<typeof makeWindow> | null) {
  const toolbar = makeWindow();
  const setToolbarWindow = vi.fn();
  registerScreenshotChannels({
    getMainWindow: () => mainWindow as never,
    getToolbarWindow: () => toolbar as never,
    setToolbarWindow,
  });
  const captureHandler = handlers.get(CH.screenshot.CAPTURE);
  if (!captureHandler) {
    throw new Error('capture handler was not registered');
  }
  return { toolbar, setToolbarWindow, capture: (request: unknown) => captureHandler(request) };
}

describe('screenshot capture channel', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    serviceMock.captureStill.mockResolvedValue(capture);
  });

  it('hands the capture to the main window and closes the toolbar', async () => {
    const mainWindow = makeWindow();
    const { toolbar, setToolbarWindow, capture: run } = register(mainWindow);

    await run({ kind: 'display', sourceId: 'screen:1:0' });

    expect(mainWindow.webContents.send).toHaveBeenCalledWith(CH.screenshot.CAPTURED, capture);
    expect(toolbar.close).toHaveBeenCalledOnce();
    expect(setToolbarWindow).toHaveBeenCalledWith(null);
  });

  it.each([
    ['null', null],
    ['an unknown kind', { kind: 'webcam', sourceId: 'screen:1:0' }],
    ['a missing source id', { kind: 'display' }],
    ['an area without one', { kind: 'area', sourceId: '' }],
    ['an empty area', { kind: 'area', sourceId: '', area: { x: 0, y: 0, width: 0, height: 5 } }],
    [
      'an area on a malformed display',
      {
        kind: 'area',
        sourceId: '',
        area: { x: 0, y: 0, width: 5, height: 5, display: { id: 'x', width: 0, height: 5 } },
      },
    ],
    [
      'a non-finite area',
      { kind: 'area', sourceId: '', area: { x: Number.NaN, y: 0, width: 5, height: 5 } },
    ],
  ])('rejects %s before hiding the toolbar', async (_label, request) => {
    const { toolbar, capture: run } = register(makeWindow());

    await expect(run(request)).rejects.toThrow('Invalid screenshot capture request');

    expect(toolbar.hide).not.toHaveBeenCalled();
    expect(serviceMock.captureStill).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['destroyed', makeWindow(true)],
  ])('keeps the toolbar and fails when the main window is %s', async (_label, mainWindow) => {
    const { toolbar, setToolbarWindow, capture: run } = register(mainWindow);

    await expect(run({ kind: 'display', sourceId: 'screen:1:0' })).rejects.toThrow(
      'Main window is not available',
    );

    expect(toolbar.close).not.toHaveBeenCalled();
    expect(toolbar.show).toHaveBeenCalledOnce();
    expect(setToolbarWindow).not.toHaveBeenCalled();
  });
});
