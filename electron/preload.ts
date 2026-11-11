import { contextBridge, webUtils } from 'electron';
import { sourcesBridge } from './modules/sources/bridge';
import { recordingBridge } from './modules/recording/bridge';
import { appBridge } from './modules/app/bridge';
import { libraryBridge } from './modules/library/bridge';
import { presetsBridge } from './modules/presets/bridge';
import { settingsBridge } from './modules/settings/bridge';
import { exportBridge } from './modules/export/bridge';
import { updaterBridge } from './modules/updater/bridge';
import { ffmpegBridge } from './modules/ffmpeg/bridge';
import { captionsBridge } from './modules/captions/bridge';
import { teleprompterBridge } from './modules/teleprompter/bridge';
import { sceneOverlayBridge } from './modules/scene-overlay/bridge';
import { cameraPreviewBridge } from './modules/camera-preview/bridge';
import { areaSelectorBridge } from './modules/area-selector/bridge';
import { importBridge } from './modules/import/bridge';
import { whatsNewBridge } from './modules/whats-new/bridge';
import { screenshotBridge } from './modules/screenshot/bridge';
import { captureShortcutsBridge } from './modules/capture-shortcuts/bridge';

contextBridge.exposeInMainWorld('screenforge', {
  ...sourcesBridge,
  ...recordingBridge,
  ...appBridge,
  ...libraryBridge,
  ...presetsBridge,
  ...settingsBridge,
  ...exportBridge,
  ...updaterBridge,
  ...ffmpegBridge,
  ...captionsBridge,
  ...teleprompterBridge,
  ...sceneOverlayBridge,
  ...cameraPreviewBridge,
  ...areaSelectorBridge,
  ...importBridge,
  ...whatsNewBridge,
  ...screenshotBridge,
  ...captureShortcutsBridge,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
});
