import type { AppStore } from '../store';
import type { CaptionSettings, ProjectCursorSettings, SavedProject } from '../types';
import { normalizeZoomClips } from './effects/zoom/clip';
import { normalizeMotionClips } from './animation/motionClips';

type CursorStateSource = Pick<
  AppStore,
  | 'cursorStyle'
  | 'cursorClickEffect'
  | 'cursorSize'
  | 'cursorHalflife'
  | 'cursorMotionBlur'
  | 'cursorMaxTilt'
  | 'cursorHideWhenIdle'
  | 'cursorIdleHideSeconds'
  | 'cursorEffect'
  | 'cursorClickShrink'
  | 'cursorColor'
  | 'cursorLabel'
  | 'cursorClickSound'
  | 'cursorClickSoundVolume'
  | 'cursorContinuousTracking'
>;

type ProjectStateSource = Pick<
  AppStore,
  | 'recordingName'
  | 'recordingResult'
  | 'zoomClips'
  | 'mediaSegments'
  | 'frame'
  | 'cursorStyle'
  | 'cursorClickEffect'
  | 'cursorSize'
  | 'cursorHalflife'
  | 'cursorMotionBlur'
  | 'cursorMaxTilt'
  | 'cursorHideWhenIdle'
  | 'cursorIdleHideSeconds'
  | 'cursorEffect'
  | 'cursorClickShrink'
  | 'cursorColor'
  | 'cursorLabel'
  | 'cursorClickSound'
  | 'cursorClickSoundVolume'
  | 'cursorContinuousTracking'
  | 'camera'
  | 'cameraClips'
  | 'cameraMediaSegments'
  | 'keyboard'
  | 'captions'
  | 'textClips'
  | 'musicClips'
  | 'maskClips'
  | 'motionClips'
>;

const EMPTY_CAPTIONS: CaptionSettings = {
  segments: [],
  model: 'base',
  language: 'en',
  captionsEnabled: false,
};

export interface ProjectSnapshot {
  recordingName: string;
  recordingResult: NonNullable<AppStore['recordingResult']>;
  zoomClips: AppStore['zoomClips'];
  mediaSegments: AppStore['mediaSegments'];
  cameraMediaSegments: AppStore['cameraMediaSegments'];
  frame: AppStore['frame'];
  cursor: ProjectCursorSettings;
  camera: AppStore['camera'];
  cameraClips: AppStore['cameraClips'];
  keyboard: AppStore['keyboard'];
  captions: CaptionSettings;
  textClips: AppStore['textClips'];
  musicClips: AppStore['musicClips'];
  maskClips: AppStore['maskClips'];
  motionClips: AppStore['motionClips'];
}

export function getCursorSnapshot(state: CursorStateSource): ProjectCursorSettings {
  return {
    style: state.cursorStyle,
    clickEffect: state.cursorClickEffect,
    size: state.cursorSize,
    halflife: state.cursorHalflife,
    motionBlur: state.cursorMotionBlur,
    maxTilt: state.cursorMaxTilt,
    hideWhenIdle: state.cursorHideWhenIdle,
    idleHideSeconds: state.cursorIdleHideSeconds,
    clickSound: state.cursorClickSound,
    clickSoundVolume: state.cursorClickSoundVolume,
    continuousTracking: state.cursorContinuousTracking,
    effect: state.cursorEffect,
    clickShrink: state.cursorClickShrink,
    color: state.cursorColor,
    label: state.cursorLabel,
  };
}

export function createProjectSnapshotFromState(state: ProjectStateSource): ProjectSnapshot | null {
  if (!state.recordingResult) {
    return null;
  }

  return {
    recordingName: state.recordingName,
    recordingResult: state.recordingResult,
    zoomClips: normalizeZoomClips(state.zoomClips),
    mediaSegments: state.mediaSegments,
    cameraMediaSegments: state.cameraMediaSegments,
    frame: state.frame,
    cursor: getCursorSnapshot(state),
    camera: state.camera,
    cameraClips: state.cameraClips,
    keyboard: state.keyboard,
    captions: state.captions,
    textClips: state.textClips,
    musicClips: state.musicClips,
    maskClips: state.maskClips,
    motionClips: state.motionClips,
  };
}

export function createProjectSnapshotFromProject(project: SavedProject): ProjectSnapshot {
  return {
    recordingName: project.name,
    recordingResult: project.result,
    zoomClips: normalizeZoomClips(project.zoomClips),
    mediaSegments: project.mediaSegments ?? [],
    frame: project.frame,
    cursor: project.cursor,
    camera: project.camera,
    keyboard: project.keyboard,
    captions: project.captions ?? EMPTY_CAPTIONS,
    maskClips: project.maskClips ?? [],
    textClips: project.textClips ?? [],
    musicClips: (project.musicClips ?? []).map((clip) => ({
      ...clip,
      name:
        clip.name ??
        clip.filePath
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '') ??
        'Music',
      timelineStart: clip.timelineStart ?? 0,
      timelineEnd: clip.timelineEnd ?? clip.duration ?? 60,
    })),
    motionClips: normalizeMotionClips(project.motionClips),
  };
}

export function serializeProjectSnapshot(snapshot: ProjectSnapshot | null): string | null {
  return snapshot ? JSON.stringify(snapshot) : null;
}

export function getProjectSignature(project: SavedProject): string {
  return serializeProjectSnapshot(createProjectSnapshotFromProject(project)) ?? '';
}
