import type {
  ProjectCameraSettings,
  ProjectCursorSettings,
  ProjectKeyboardSettings,
} from '../types';
import type { ZoomClip } from '../types/timeline';

export const DEFAULT_CURSOR_SETTINGS: ProjectCursorSettings = {
  enabled: true,
  style: 'cursor01',
  clickEffect: 'none',
  size: 125,
  halflife: 0.06,
  motionBlur: true,
  maxTilt: 4,
  hideWhenIdle: false,
  idleHideSeconds: 5,
  clickSound: 'none',
  clickSoundVolume: 0.3,
  continuousTracking: true,
};

export const DEFAULT_ZOOM_CLIP: Pick<
  ZoomClip,
  | 'scale'
  | 'cx'
  | 'cy'
  | 'easeIn'
  | 'easeOut'
  | 'mode'
  | 'preset'
  | 'cinematicIntensity'
  | 'cinematicDepth'
  | 'cinematicFocus'
  | 'cinematicBackgroundFade'
  | 'cinematicTilt'
  | 'cinematicMotionBlur'
  | 'cinematicTiltMode'
  | 'cinematicTiltDirection'
> = {
  scale: 2,
  cx: 0.5,
  cy: 0.5,
  easeIn: 0.6,
  easeOut: 0.8,
  mode: 'auto',
  preset: 'standard',
  cinematicIntensity: 0.65,
  cinematicDepth: 0.65,
  cinematicFocus: 0.75,
  cinematicBackgroundFade: 0.75,
  cinematicTilt: 0.65,
  cinematicMotionBlur: 0.2,
  cinematicTiltMode: 'follow',
  cinematicTiltDirection: 'left',
};

export const DEFAULT_CAMERA_SETTINGS: ProjectCameraSettings = {
  enabled: false,
  x: 0.7,
  y: 0.6,
  size: 0.22,
  shape: 'square',
  roundness: 0.66,
  mirror: false,
  zoomResponse: 0.15,
  shadow: {
    blur: 24,
    opacity: 0.35,
  },
  backgroundBlur: 0,
  fixedRadius: 80,
  zoomRadiusScale: 1.0,
  fixedPadding: 20,
};

export const DEFAULT_KEYBOARD_SETTINGS: ProjectKeyboardSettings = {
  enabled: true,
  position: 'bottom-center',
  opacity: 1.0,
  size: 'medium',
  background: 'dark',
};
