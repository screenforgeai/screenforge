import type { BrowserWindow } from 'electron';
import { globalShortcut } from 'electron';
import { CH } from '../../channels';
import { listenChannel, handleChannel } from '../../lib/ipc-main';
import log from '../../lib/logger';
import {
  openSceneOverlay,
  closeSceneOverlay,
  resizeSceneOverlay,
  getOverlayWindow,
} from './service';
import { openTeleprompter, getTeleprompterWindow } from '../teleprompter/service';

type Options = {
  preloadPath: string;
  loadURL: (win: BrowserWindow, hash: string) => void;
  getMainWindow: () => BrowserWindow | null;
  getToolbarWindow: () => BrowserWindow | null;
};

export function registerSceneOverlayChannels({
  preloadPath,
  loadURL,
  getMainWindow,
  getToolbarWindow,
}: Options): void {
  const sendToMain = (channel: string, ...args: unknown[]) =>
    getMainWindow()?.webContents.send(channel, ...args);

  const sendToOverlay = (channel: string, ...args: unknown[]) =>
    getOverlayWindow()?.webContents.send(channel, ...args);

  const sendToToolbar = (channel: string, ...args: unknown[]) =>
    getToolbarWindow()?.webContents.send(channel, ...args);

  listenChannel(CH.sceneOverlay.OPEN, () =>
    openSceneOverlay(preloadPath, loadURL, {
      onReady: () => {
        // Unreliable on Linux/Wayland — scene switching stays available from
        // the overlay UI itself if registration fails.
        try {
          globalShortcut.register('CommandOrControl+Alt+]', () =>
            sendToOverlay(CH.sceneOverlay.NEXT_SCENE),
          );
          globalShortcut.register('CommandOrControl+Alt+[', () =>
            sendToOverlay(CH.sceneOverlay.PREV_SCENE),
          );
        } catch (err) {
          log.warn('[scene-overlay] shortcut registration failed:', err);
        }
        sendToMain(CH.sceneOverlay.READY);
      },
      onClosed: () => {
        try {
          globalShortcut.unregister('CommandOrControl+Alt+]');
          globalShortcut.unregister('CommandOrControl+Alt+[');
        } catch (err) {
          log.warn('[scene-overlay] shortcut unregistration failed:', err);
        }
        sendToMain(CH.sceneOverlay.CLOSED);
      },
    }),
  );

  listenChannel(CH.sceneOverlay.CLOSE, () => {
    closeSceneOverlay();
    sendToMain(CH.sceneOverlay.CLOSED);
  });

  handleChannel(CH.sceneOverlay.RESIZE, (height: number) => {
    resizeSceneOverlay(height);
  });

  // Overlay sends a scene mutation → forward to the main window to update the store
  listenChannel(CH.sceneOverlay.UPDATE_SCENE, (payload: unknown) => {
    sendToMain(CH.sceneOverlay.ON_SCENE_UPDATED, payload);
  });

  // Open the teleprompter and position it directly below the scene overlay window
  listenChannel(CH.sceneOverlay.OPEN_TELEPROMPTER_BELOW, () => {
    const positionBelow = () => {
      const overlay = getOverlayWindow();
      const tp = getTeleprompterWindow();
      if (overlay && tp && !overlay.isDestroyed() && !tp.isDestroyed()) {
        const { x, y, height } = overlay.getBounds();
        tp.setPosition(x, y + height + 8);
      }
      sendToToolbar(CH.teleprompter.READY);
      sendToOverlay(CH.teleprompter.READY);
    };

    const existing = getTeleprompterWindow();
    if (existing && !existing.isDestroyed()) {
      positionBelow();
    } else {
      openTeleprompter(preloadPath, loadURL, {
        onReady: positionBelow,
        onClosed: () => {
          sendToToolbar(CH.teleprompter.CLOSED);
          sendToOverlay(CH.teleprompter.CLOSED);
        },
      });
    }
  });
}
