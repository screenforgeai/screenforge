// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CH } from '../../channels';

const listeners = vi.hoisted(() => new Map<string, (...args: unknown[]) => void>());

vi.mock('electron', () => ({ app: { dock: { show: vi.fn() } } }));
vi.mock('../../lib/ipc-main', () => ({
  listenChannel: (channel: string, handler: (...args: unknown[]) => void) => {
    listeners.set(channel, handler);
  },
}));
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../recording/utils/tray', () => ({
  destroyRecordingTray: vi.fn(),
  startRecordingTray: vi.fn(),
}));
vi.mock('../camera-preview/service', () => ({ closeCameraPreview: vi.fn() }));
vi.mock('./toolbar-mouse', () => ({
  setToolbarMouseInteractivity: vi.fn(),
  setToolbarShape: vi.fn(),
}));

import { registerWindowChannels } from './window-controller';

function createWindow() {
  return {
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

describe('window controller: permissions guide', () => {
  beforeEach(() => {
    listeners.clear();
  });

  it('swaps the toolbar for the main window and asks it to open the guide', () => {
    const mainWindow = createWindow();
    const toolbarWindow = createWindow();
    const setToolbarWindow = vi.fn();
    registerWindowChannels({
      getMainWindow: () => mainWindow as never,
      getToolbarWindow: () => toolbarWindow as never,
      setToolbarWindow,
      createToolbarWindow: vi.fn(),
    });

    listeners.get(CH.app.SHOW_PERMISSIONS_GUIDE)?.();

    expect(toolbarWindow.close).toHaveBeenCalledOnce();
    expect(setToolbarWindow).toHaveBeenCalledWith(null);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(CH.app.PERMISSIONS_GUIDE_REQUESTED);
    expect(mainWindow.show).toHaveBeenCalledOnce();
    expect(mainWindow.focus).toHaveBeenCalledOnce();
  });
});
