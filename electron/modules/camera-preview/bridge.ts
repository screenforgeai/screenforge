import { CH } from '../../channels';
import { createInvokeBridge, createSendBridge } from '../../lib/ipc-renderer';

export const cameraPreviewBridge = {
  openCameraPreview: createSendBridge<[string | null]>(CH.cameraPreview.OPEN),
  closeCameraPreview: createSendBridge<[]>(CH.cameraPreview.CLOSE),
  getCameraPreviewDeviceId: createInvokeBridge<[], string | null>(CH.cameraPreview.GET_DEVICE_ID),
};
