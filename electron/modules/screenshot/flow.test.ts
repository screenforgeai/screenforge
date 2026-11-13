// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CH } from '../../channels';

const serviceMock = vi.hoisted(() => ({ captureStill: vi.fn(), cropPng: vi.fn() }));

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../camera-preview/service', () => ({ closeCameraPreview: vi.fn() }));
vi.mock('./service', () => serviceMock);

import {
  SCREENSHOT_FAILED_MESSAGE,
  captureAndOpenEditor,
  isAreaScreenshotInFlight,
  takeAreaScreenshot,
  takePickedAreaScreenshot,
  type AreaScreenshotDeps,
  type PickedAreaScreenshotDeps,
} from './flow';
import { WAYLAND_PICKED_SCREEN_ID } from '../../../src/lib/recording/waylandPicker';

const area = {
  x: 10,
  y: 20,
  width: 300,
  height: 200,
  display: { id: 1, width: 1920, height: 1080 },
};
const capture = { kind: 'area', png: new Uint8Array([1, 2, 3]), width: 300, height: 200 };

function makeWindow(visible = true) {
  let isVisible = visible;
  return {
    hide: vi.fn(() => {
      isVisible = false;
    }),
    show: vi.fn(() => {
      isVisible = true;
    }),
    close: vi.fn(),
    focus: vi.fn(),
    isVisible: vi.fn(() => isVisible),
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  };
}

function makeDeps(overrides: Partial<AreaScreenshotDeps> = {}, mainVisible = true) {
  const mainWindow = makeWindow(mainVisible);
  const deps = {
    getMainWindow: () => mainWindow as never,
    getToolbarWindow: () => null,
    setToolbarWindow: vi.fn(),
    isBusy: () => false,
    preparePermissions: vi.fn(async () => undefined),
    selectArea: vi.fn(async () => area),
    warn: vi.fn(),
    ...overrides,
  };
  return { deps, mainWindow };
}

describe('takeAreaScreenshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMock.captureStill.mockResolvedValue(capture);
  });

  it('captures the selected area and opens it in the editor', async () => {
    const { deps, mainWindow } = makeDeps();

    await expect(takeAreaScreenshot(deps)).resolves.toBe('taken');

    expect(mainWindow.hide).toHaveBeenCalledOnce();
    expect(serviceMock.captureStill).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'area', area }),
    );
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(CH.screenshot.CAPTURED, capture);
    expect(mainWindow.show).toHaveBeenCalled();
  });

  it('brings the main window back when the selection is cancelled', async () => {
    const { deps, mainWindow } = makeDeps({ selectArea: vi.fn(async () => null) });

    await expect(takeAreaScreenshot(deps)).resolves.toBe('cancelled');

    expect(mainWindow.hide).toHaveBeenCalledOnce();
    expect(mainWindow.show).toHaveBeenCalledOnce();
    expect(serviceMock.captureStill).not.toHaveBeenCalled();
  });

  it('leaves a hidden main window hidden when the selection is cancelled', async () => {
    const { deps, mainWindow } = makeDeps({ selectArea: vi.fn(async () => null) }, false);

    await takeAreaScreenshot(deps);

    expect(mainWindow.show).not.toHaveBeenCalled();
  });

  it('does nothing while a recording is busy', async () => {
    const { deps } = makeDeps({ isBusy: () => true });

    await expect(takeAreaScreenshot(deps)).resolves.toBe('skipped');

    expect(deps.selectArea).not.toHaveBeenCalled();
  });

  it('ignores a second press while the first screenshot is still in progress', async () => {
    let finishSelection: (value: typeof area) => void = () => undefined;
    const { deps } = makeDeps({
      selectArea: vi.fn(
        () =>
          new Promise<typeof area>((resolve) => {
            finishSelection = resolve;
          }),
      ),
    });

    const first = takeAreaScreenshot(deps);
    await expect(takeAreaScreenshot(deps)).resolves.toBe('skipped');
    await vi.waitFor(() => expect(deps.selectArea).toHaveBeenCalledOnce());
    finishSelection(area);
    await expect(first).resolves.toBe('taken');
  });

  it('warns and opens no selector when screen access is missing', async () => {
    const { deps, mainWindow } = makeDeps({
      preparePermissions: vi.fn(async () => {
        throw new Error('Allow Screen Recording in System Settings');
      }),
    });

    await expect(takeAreaScreenshot(deps)).resolves.toBe('failed');

    expect(deps.warn).toHaveBeenCalledWith('Allow Screen Recording in System Settings');
    expect(deps.selectArea).not.toHaveBeenCalled();
    expect(mainWindow.hide).not.toHaveBeenCalled();
  });

  it('warns and brings the main window back when the capture fails', async () => {
    serviceMock.captureStill.mockRejectedValue(new Error('display gone'));
    const { deps, mainWindow } = makeDeps();

    await expect(takeAreaScreenshot(deps)).resolves.toBe('failed');

    expect(deps.warn).toHaveBeenCalledWith(SCREENSHOT_FAILED_MESSAGE);
    expect(mainWindow.show).toHaveBeenCalledOnce();
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('drops the capture if a recording started while the area was being drawn', async () => {
    let busy = false;
    const { deps, mainWindow } = makeDeps({
      isBusy: () => busy,
      selectArea: vi.fn(async () => {
        busy = true;
        return area;
      }),
    });

    await expect(takeAreaScreenshot(deps)).resolves.toBe('skipped');

    expect(serviceMock.captureStill).not.toHaveBeenCalled();
    expect(mainWindow.show).toHaveBeenCalledOnce();
  });

  it('warns and brings the main window back when the area selector fails', async () => {
    const { deps, mainWindow } = makeDeps({
      selectArea: vi.fn(async () => {
        throw new Error('selector window failed');
      }),
    });

    await expect(takeAreaScreenshot(deps)).resolves.toBe('failed');

    expect(deps.warn).toHaveBeenCalledWith(SCREENSHOT_FAILED_MESSAGE);
    expect(mainWindow.show).toHaveBeenCalledOnce();
    expect(isAreaScreenshotInFlight()).toBe(false);
  });

  it('reports a screenshot in progress until it finishes', async () => {
    let finishSelection: (value: null) => void = () => undefined;
    const { deps } = makeDeps({
      selectArea: vi.fn(
        () =>
          new Promise<null>((resolve) => {
            finishSelection = resolve;
          }),
      ),
    });

    const run = takeAreaScreenshot(deps);
    expect(isAreaScreenshotInFlight()).toBe(true);
    await vi.waitFor(() => expect(deps.selectArea).toHaveBeenCalledOnce());
    finishSelection(null);
    await run;
    expect(isAreaScreenshotInFlight()).toBe(false);
  });
});

describe('captureAndOpenEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMock.captureStill.mockResolvedValue(capture);
  });

  it('leaves alone a toolbar that opened while the still was being taken', async () => {
    const mainWindow = makeWindow();
    const newToolbar = makeWindow();
    let currentToolbar: ReturnType<typeof makeWindow> | null = null;
    serviceMock.captureStill.mockImplementation(async () => {
      currentToolbar = newToolbar;
      return capture;
    });
    const setToolbarWindow = vi.fn();

    await captureAndOpenEditor(
      { kind: 'area', sourceId: 'screen:0', area },
      {
        getMainWindow: () => mainWindow as never,
        getToolbarWindow: () => currentToolbar as never,
        setToolbarWindow,
      },
    );

    expect(setToolbarWindow).not.toHaveBeenCalled();
    expect(newToolbar.close).not.toHaveBeenCalled();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(CH.screenshot.CAPTURED, capture);
  });
});

describe('takePickedAreaScreenshot (Wayland)', () => {
  const still = {
    kind: 'display',
    png: new Uint8Array([9, 9]),
    width: 2560,
    height: 1440,
    scaleFactor: 1,
  };
  const picked = { x: 640, y: 0, width: 1280, height: 720 };
  const cropped = { png: new Uint8Array([7]), width: 1280, height: 720 };

  function makePickedDeps(overrides: Partial<PickedAreaScreenshotDeps> = {}) {
    const mainWindow = makeWindow(true);
    const toolbar = makeWindow(true);
    const deps = {
      getMainWindow: () => mainWindow as never,
      getToolbarWindow: () => toolbar as never,
      setToolbarWindow: vi.fn(),
      isBusy: () => false,
      preparePermissions: vi.fn(async () => undefined),
      selectAreaOnStill: vi.fn(async () => picked),
      warn: vi.fn(),
      ...overrides,
    };
    return { deps, mainWindow, toolbar };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    serviceMock.captureStill.mockResolvedValue(still);
    serviceMock.cropPng.mockReturnValue(cropped);
  });

  it('picks the screen in the share dialog first, then the area on that still', async () => {
    const { deps, mainWindow, toolbar } = makePickedDeps();

    await expect(takePickedAreaScreenshot(deps)).resolves.toBe('taken');

    expect(toolbar.hide).toHaveBeenCalled();
    expect(serviceMock.captureStill).toHaveBeenCalledWith({
      kind: 'display',
      sourceId: WAYLAND_PICKED_SCREEN_ID,
    });
    expect(deps.selectAreaOnStill).toHaveBeenCalledWith(still);
    expect(serviceMock.cropPng).toHaveBeenCalledWith(still.png, picked);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(CH.screenshot.CAPTURED, {
      kind: 'area',
      png: cropped.png,
      width: 1280,
      height: 720,
      scaleFactor: 1,
    });
    expect(toolbar.close).toHaveBeenCalled();
  });

  it('brings the toolbar back when the area is cancelled', async () => {
    const { deps, toolbar, mainWindow } = makePickedDeps({
      selectAreaOnStill: vi.fn(async () => null),
    });

    await expect(takePickedAreaScreenshot(deps)).resolves.toBe('cancelled');

    expect(toolbar.show).toHaveBeenCalled();
    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.webContents.send).not.toHaveBeenCalled();
  });

  it('treats a closed share dialog as a cancel, without a warning', async () => {
    serviceMock.captureStill.mockRejectedValue(
      new Error('No image available for display capture (screen:wayland)'),
    );
    const { deps, toolbar } = makePickedDeps();

    await expect(takePickedAreaScreenshot(deps)).resolves.toBe('cancelled');

    expect(deps.warn).not.toHaveBeenCalled();
    expect(deps.selectAreaOnStill).not.toHaveBeenCalled();
    expect(toolbar.show).toHaveBeenCalled();
  });

  it('warns when the capture itself fails', async () => {
    serviceMock.captureStill.mockRejectedValue(new Error('portal crashed'));
    const { deps } = makePickedDeps();

    await expect(takePickedAreaScreenshot(deps)).resolves.toBe('failed');

    expect(deps.warn).toHaveBeenCalledWith(SCREENSHOT_FAILED_MESSAGE);
  });
});
