import type { CaptureStoreSnapshot, CaptionSettings } from '../../types';
import type { AppStore } from '../../store';
import { cloneFrameSettings } from '../effects/frame';
import { normalizeZoomClips } from '../effects/zoom/clip';
import { normalizeZoomStyle } from '../effects/zoom/style';
import { cloneMotionClips } from '../animation/motionClips';

type CaptureStoreSnapshotSource = Pick<
  AppStore,
  | 'frame'
  | 'zoomClips'
  | 'zoomStyle'
  | 'textClips'
  | 'camera'
  | 'keyboard'
  | 'cursorEnabled'
  | 'cursorStyle'
  | 'cursorSize'
  | 'cursorClickEffect'
  | 'cursorHalflife'
  | 'cursorMotionBlur'
  | 'cursorMaxTilt'
  | 'cursorHideWhenIdle'
  | 'cursorIdleHideSeconds'
  | 'cameraClips'
  | 'maskClips'
  | 'motionClips'
>;

export function createCaptureStoreSnapshot(
  state: CaptureStoreSnapshotSource,
  captionsOverride?: CaptionSettings,
): CaptureStoreSnapshot {
  return {
    frame: cloneFrameSettings(state.frame),
    zoomClips: normalizeZoomClips(state.zoomClips),
    zoomStyle: normalizeZoomStyle(state.zoomStyle),
    textClips: state.textClips.map((clip) => ({ ...clip })),
    camera: {
      ...state.camera,
      shadow: { ...state.camera.shadow },
    },
    keyboard: { ...state.keyboard },
    cursorEnabled: state.cursorEnabled,
    cursorStyle: state.cursorStyle,
    cursorSize: state.cursorSize,
    cursorClickEffect: state.cursorClickEffect,
    cursorHalflife: state.cursorHalflife,
    cursorMotionBlur: state.cursorMotionBlur,
    cursorMaxTilt: state.cursorMaxTilt,
    cursorHideWhenIdle: state.cursorHideWhenIdle,
    cursorIdleHideSeconds: state.cursorIdleHideSeconds,
    captions: captionsOverride,
    cameraClips: state.cameraClips.map((c) => ({ ...c })),
    maskClips: state.maskClips.map((c) => ({ ...c })),
    motionClips: cloneMotionClips(state.motionClips),
  };
}
