import { CH } from '../../channels';
import { createSendBridge, createInvokeBridge, createSubscription } from '../../lib/ipc-renderer';
import type { SceneStatus } from '../../../src/store/types';

export type SceneUpdatePayload = { id: string; patch: { status: SceneStatus } };

export const sceneOverlayBridge = {
  openSceneOverlay: createSendBridge<[]>(CH.sceneOverlay.OPEN),
  closeSceneOverlay: createSendBridge<[]>(CH.sceneOverlay.CLOSE),
  resizeSceneOverlay: createInvokeBridge<[number], void>(CH.sceneOverlay.RESIZE),
  updateSceneFromOverlay: createSendBridge<[SceneUpdatePayload]>(CH.sceneOverlay.UPDATE_SCENE),
  onSceneOverlayReady: createSubscription<void>(CH.sceneOverlay.READY),
  onSceneOverlayClosed: createSubscription<void>(CH.sceneOverlay.CLOSED),
  onSceneUpdatedFromOverlay: createSubscription<SceneUpdatePayload>(
    CH.sceneOverlay.ON_SCENE_UPDATED,
  ),
  openTeleprompterBelowOverlay: createSendBridge<[]>(CH.sceneOverlay.OPEN_TELEPROMPTER_BELOW),
  onSceneNextRequested: createSubscription<void>(CH.sceneOverlay.NEXT_SCENE),
  onScenePrevRequested: createSubscription<void>(CH.sceneOverlay.PREV_SCENE),
};
