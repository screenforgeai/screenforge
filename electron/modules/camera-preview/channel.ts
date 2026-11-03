import type { BrowserWindow } from 'electron';
import { CH } from '../../channels';
import { handleChannel, listenChannel } from '../../lib/ipc-main';
import { openCameraPreview, closeCameraPreview, getPendingCameraDeviceId } from './service';

type Options = {
  preloadPath: string;
  loadURL: (win: BrowserWindow, hash: string) => void;
};

export function registerCameraPreviewChannels({ preloadPath, loadURL }: Options): void {
  listenChannel<[string | null]>(CH.cameraPreview.OPEN, (deviceId) => {
    openCameraPreview(deviceId, preloadPath, loadURL);
  });

  listenChannel(CH.cameraPreview.CLOSE, () => {
    closeCameraPreview();
  });

  handleChannel(CH.cameraPreview.GET_DEVICE_ID, () => {
    return getPendingCameraDeviceId();
  });
}
