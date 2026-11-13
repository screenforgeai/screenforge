import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import type {
  RecordingResult,
  ToolbarLayout,
  ToolbarShapeRect,
  ToolbarViewportMode,
} from '../../../src/types';
import { CH } from '../../channels';
import { handleChannel, listenChannel } from '../../lib/ipc-main';
import log from '../../lib/logger';
import { destroyRecordingTray, startRecordingTray } from '../recording/utils/tray';
import { closeCameraPreview } from '../camera-preview/service';
import {
  getBottomAnchoredBounds,
  getToolbarViewportHeight,
} from '../../../src/lib/toolbarViewport';
import { setToolbarMouseInteractivity, setToolbarShape } from './toolbar-mouse';

type WindowControllerOptions = {
  getMainWindow: () => BrowserWindow | null;
  getToolbarWindow: () => BrowserWindow | null;
  setToolbarWindow: (window: BrowserWindow | null) => void;
  createToolbarWindow: () => BrowserWindow;
  /** 'window': the toolbar window is just the toolbar, with no click-through to manage. */
  getToolbarLayout: () => ToolbarLayout;
};

/** The largest the toolbar window grows to fit an open menu. */
const MAX_TOOLBAR_WINDOW = { width: 1600, height: 900 };

function setToolbarViewport(window: BrowserWindow, mode: ToolbarViewportMode): void {
  const currentBounds = window.getBounds();
  const nextHeight = getToolbarViewportHeight(mode);

  if (currentBounds.height === nextHeight) {
    return;
  }

  const nextBounds = getBottomAnchoredBounds(currentBounds, nextHeight);
  window.setBounds(nextBounds);
}

export function registerWindowChannels({
  getMainWindow,
  getToolbarWindow,
  setToolbarWindow,
  createToolbarWindow,
  getToolbarLayout,
}: WindowControllerOptions): void {
  const isOverlay = () => getToolbarLayout() === 'overlay';

  handleChannel<[], ToolbarLayout>(CH.app.GET_TOOLBAR_LAYOUT, () => getToolbarLayout());

  listenChannel<[{ width: number; height: number }]>(CH.app.SET_TOOLBAR_SIZE, (size) => {
    const toolbarWindow = getToolbarWindow();
    if (!toolbarWindow || isOverlay()) {
      return;
    }
    const width = Math.round(Math.min(Math.max(size.width, 1), MAX_TOOLBAR_WINDOW.width));
    const height = Math.round(Math.min(Math.max(size.height, 1), MAX_TOOLBAR_WINDOW.height));
    const [currentWidth, currentHeight] = toolbarWindow.getContentSize();
    if (width !== currentWidth || height !== currentHeight) {
      // Grows from its top-left corner: Wayland keeps a window where the user put it.
      toolbarWindow.setContentSize(width, height);
    }
  });

  listenChannel(CH.app.MINIMIZE_TO_DOCK, () => {
    closeCameraPreview();
    getToolbarWindow()?.close();
    setToolbarWindow(null);
    getMainWindow()?.hide();
    app.dock?.show();
  });

  listenChannel(CH.app.SHOW_MAIN, () => {
    closeCameraPreview();
    getToolbarWindow()?.close();
    setToolbarWindow(null);
    getMainWindow()?.show();
    getMainWindow()?.focus();
  });

  listenChannel(CH.app.SHOW_TOOLBAR, () => {
    getMainWindow()?.hide();

    const toolbarWindow = getToolbarWindow();
    if (!toolbarWindow) {
      setToolbarWindow(createToolbarWindow());
      return;
    }

    if (isOverlay()) {
      setToolbarMouseInteractivity(toolbarWindow, false);
    }
    toolbarWindow.show();
    toolbarWindow.focus();
  });

  listenChannel<[boolean]>(CH.app.SET_TOOLBAR_MOUSE_INTERACTIVITY, (interactive) => {
    const toolbarWindow = getToolbarWindow();
    if (!toolbarWindow || !isOverlay()) {
      return;
    }

    setToolbarMouseInteractivity(toolbarWindow, interactive);
  });

  listenChannel<[ToolbarShapeRect[]]>(CH.app.SET_TOOLBAR_SHAPE, (rects) => {
    const toolbarWindow = getToolbarWindow();
    if (!toolbarWindow || !isOverlay()) {
      return;
    }

    setToolbarShape(toolbarWindow, rects);
  });

  listenChannel<[ToolbarViewportMode]>(CH.app.SET_TOOLBAR_VIEWPORT, (mode) => {
    const toolbarWindow = getToolbarWindow();
    if (!toolbarWindow) {
      return;
    }

    setToolbarViewport(toolbarWindow, mode);
  });

  listenChannel(CH.recording.HIDE_TOOLBAR, () => {
    if (process.platform !== 'linux') {
      return;
    }

    getToolbarWindow()?.hide();
    startRecordingTray(() => {
      getToolbarWindow()?.webContents.send(CH.recording.STOP_REQUESTED);
    });
  });

  listenChannel(CH.recording.PROCESSING, () => {
    log.info('[recording-ui] processing transition');
    closeCameraPreview();
    getToolbarWindow()?.hide();
    getMainWindow()?.webContents.send(CH.recording.PROCESSING);
    getMainWindow()?.show();
    getMainWindow()?.focus();
  });

  listenChannel<[RecordingResult]>(CH.recording.FINISHED, (data) => {
    log.info('[recording-ui] finished transition', {
      filePath: data.filePath,
      duration: data.duration,
    });
    destroyRecordingTray();
    closeCameraPreview();
    getToolbarWindow()?.close();
    setToolbarWindow(null);
    getMainWindow()?.webContents.send(CH.recording.LOAD, data);
    getMainWindow()?.show();
  });

  listenChannel<[string]>(CH.recording.FAILED, (message) => {
    log.error('[recording-ui] failed transition', { message });
    destroyRecordingTray();
    closeCameraPreview();
    getToolbarWindow()?.close();
    setToolbarWindow(null);
    getMainWindow()?.webContents.send(CH.recording.FAILED, message);
    getMainWindow()?.show();
    getMainWindow()?.focus();
  });
}
