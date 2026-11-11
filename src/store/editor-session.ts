import type { SavedProject } from '../types';
import { createInitialMediaSegments, getInitialPlaybackTime } from '../lib/helpers/segments';
import { DEFAULT_FRAME, cloneFrameSettings } from '../lib/effects/frame';
import {
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_CURSOR_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
} from './defaults';
import type { EditorSessionState } from './types';
import { normalizeZoomClips } from '../lib/effects/zoom/clip';
import { normalizeCursorClickSound } from '../lib/effects/cursor/clickSoundOptions';
import type { CameraClip, MediaSegment } from '../types/timeline';
import {
  cloneMotionClips,
  createMotionClip,
  normalizeMotionClips,
} from '../lib/animation/motionClips';
import type { MotionClip } from '../lib/animation/motionClips';
import { migrateTransitionsToMotion } from '../lib/animation/migrateTransitions';

/** New clips open with a quick fade, as they did when clips had transitions. */
const DEFAULT_INTRO_LENGTH = 0.35;

export function defaultClipIntro(segment: MediaSegment): MotionClip {
  return createMotionClip(
    'fadeIn',
    segment.timelineStart,
    segment.timelineStart + DEFAULT_INTRO_LENGTH,
    segment.id,
  );
}

export function cloneEditorSession(session: EditorSessionState): EditorSessionState {
  return {
    ...session,
    zoomClips: normalizeZoomClips(session.zoomClips),
    mediaSegments: session.mediaSegments.map((segment) => ({ ...segment })),
    cameraMediaSegments: session.cameraMediaSegments.map((segment) => ({ ...segment })),
    camera: {
      ...session.camera,
      shadow: { ...session.camera.shadow },
    },
    keyboard: { ...session.keyboard },
    frame: cloneFrameSettings(session.frame),
    captions: {
      ...session.captions,
      segments: session.captions.segments.map((seg) => ({
        ...seg,
        words: seg.words.map((w) => ({ ...w })),
      })),
    },
    textClips: session.textClips.map((clip) => ({ ...clip })),
    musicClips: session.musicClips.map((clip) => ({ ...clip })),
    cameraClips: session.cameraClips.map((clip) => ({ ...clip })),
    maskClips: session.maskClips.map((clip) => ({ ...clip })),
    motionClips: cloneMotionClips(session.motionClips),
  };
}

const DEFAULT_CAPTIONS = {
  segments: [],
  model: 'base' as const,
  language: 'en',
  captionsEnabled: false,
  fontFamily: 'system-ui',
  fontScale: 1.0,
  bold: true,
  italic: false,
  textColor: '#ffffff',
  highlightColor: '#ffffff',
  textOpacity: 100,
  backgroundEnabled: true,
  backgroundColor: '#0a0a0c',
  backgroundOpacity: 60,
  backgroundRadius: 30,
  position: 'bottom' as const,
};

export function createEmptyEditorSession(): EditorSessionState {
  return {
    recordingResult: null,
    recordingName: 'Untitled',
    currentProjectId: null,
    selectedClip: null,
    zoomClips: [],
    mediaSegments: [],
    cameraMediaSegments: [],
    isGapPlayback: false,
    currentTime: 0,
    cursorEnabled: DEFAULT_CURSOR_SETTINGS.enabled,
    cursorStyle: DEFAULT_CURSOR_SETTINGS.style,
    cursorClickEffect: DEFAULT_CURSOR_SETTINGS.clickEffect,
    cursorSize: DEFAULT_CURSOR_SETTINGS.size,
    cursorHalflife: DEFAULT_CURSOR_SETTINGS.halflife,
    cursorMotionBlur: DEFAULT_CURSOR_SETTINGS.motionBlur,
    cursorMaxTilt: DEFAULT_CURSOR_SETTINGS.maxTilt,
    cursorHideWhenIdle: DEFAULT_CURSOR_SETTINGS.hideWhenIdle,
    cursorIdleHideSeconds: DEFAULT_CURSOR_SETTINGS.idleHideSeconds,
    cursorClickSound: DEFAULT_CURSOR_SETTINGS.clickSound,
    cursorClickSoundVolume: DEFAULT_CURSOR_SETTINGS.clickSoundVolume,
    cursorContinuousTracking: DEFAULT_CURSOR_SETTINGS.continuousTracking,
    camera: {
      ...DEFAULT_CAMERA_SETTINGS,
      shadow: { ...DEFAULT_CAMERA_SETTINGS.shadow },
    },
    keyboard: { ...DEFAULT_KEYBOARD_SETTINGS },
    frame: DEFAULT_FRAME,
    captions: { ...DEFAULT_CAPTIONS },
    textClips: [],
    musicClips: [],
    cameraClips: [],
    maskClips: [],
    motionClips: [],
    isCropEditing: false,
  };
}

export function createRecordingSession(
  recordingResult: NonNullable<EditorSessionState['recordingResult']>,
): EditorSessionState {
  const mediaSegments = createInitialMediaSegments(recordingResult.duration);
  return {
    ...createEmptyEditorSession(),
    recordingResult,
    camera: {
      ...DEFAULT_CAMERA_SETTINGS,
      shadow: { ...DEFAULT_CAMERA_SETTINGS.shadow },
      enabled: Boolean(recordingResult.cameraPath),
    },
    keyboard: { ...DEFAULT_KEYBOARD_SETTINGS },
    mediaSegments,
    motionClips: mediaSegments.map(defaultClipIntro),
    cameraMediaSegments: recordingResult.cameraPath
      ? createInitialMediaSegments(recordingResult.duration)
      : [],
    cameraClips: recordingResult.cameraPath
      ? [
          {
            id: `camera-${Date.now()}`,
            start: 0,
            end: recordingResult.duration,
            x: DEFAULT_CAMERA_SETTINGS.x,
            y: DEFAULT_CAMERA_SETTINGS.y,
            size: DEFAULT_CAMERA_SETTINGS.size,
            layout: 'pip' as const,
          },
        ]
      : [],
  };
}

export function createProjectSession(project: SavedProject): EditorSessionState {
  const savedSegments = (
    project.mediaSegments ?? createInitialMediaSegments(project.result.duration)
  ).map((segment) => ({ ...segment }));
  const savedMotion = normalizeMotionClips(project.motionClips);
  // Projects saved before Motion replaced clip transitions get them converted
  // into intros and outros once, so they look exactly as before.
  const { mediaSegments, motionClips } = project.motionVersion
    ? { mediaSegments: savedSegments, motionClips: savedMotion }
    : migrateTransitionsToMotion(savedSegments, savedMotion);
  return {
    ...createEmptyEditorSession(),
    recordingResult: project.result,
    recordingName: project.name,
    currentProjectId: project.id,
    zoomClips: normalizeZoomClips(project.zoomClips),
    mediaSegments,
    currentTime: getInitialPlaybackTime(mediaSegments, motionClips),
    frame: project.frame ? cloneFrameSettings(project.frame) : DEFAULT_FRAME,
    cursorEnabled: project.cursor.enabled ?? true,
    cursorStyle: project.cursor.style,
    cursorClickEffect: project.cursor.clickEffect,
    cursorSize: project.cursor.size,
    cursorHalflife: project.cursor.halflife,
    cursorMotionBlur: project.cursor.motionBlur,
    cursorMaxTilt: project.cursor.maxTilt,
    cursorHideWhenIdle: project.cursor.hideWhenIdle,
    cursorIdleHideSeconds: project.cursor.idleHideSeconds,
    cursorClickSound: normalizeCursorClickSound(project.cursor.clickSound),
    cursorClickSoundVolume: project.cursor.clickSoundVolume,
    cursorContinuousTracking: project.cursor.continuousTracking ?? true,
    camera: {
      ...project.camera,
      shadow: { ...project.camera.shadow },
      fixedRadius: project.camera?.fixedRadius ?? DEFAULT_CAMERA_SETTINGS.fixedRadius,
      zoomRadiusScale: project.camera?.zoomRadiusScale ?? DEFAULT_CAMERA_SETTINGS.zoomRadiusScale,
      fixedPadding: project.camera?.fixedPadding ?? DEFAULT_CAMERA_SETTINGS.fixedPadding,
    },
    keyboard: { ...project.keyboard },
    captions: project.captions
      ? {
          ...DEFAULT_CAPTIONS,
          ...project.captions,
          captionsEnabled: project.captions.captionsEnabled ?? false,
          segments: project.captions.segments.map((seg) => ({
            ...seg,
            words: seg.words.map((w) => ({ ...w })),
          })),
        }
      : { ...DEFAULT_CAPTIONS },
    textClips: (project.textClips ?? []).map((clip) => ({ ...clip })),
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
    maskClips: (project.maskClips ?? []).map((c) => ({ ...c })),
    motionClips,
    cameraClips: (() => {
      const saved = (project as SavedProject & { cameraClips?: unknown }).cameraClips;
      if (Array.isArray(saved) && saved.length > 0) {
        return (saved as CameraClip[]).map((c) => ({ ...c }));
      }
      if (project.camera?.enabled && project.result.cameraPath) {
        const dur = (project.mediaSegments ?? []).reduce(
          (max: number, s: { timelineEnd: number }) => Math.max(max, s.timelineEnd),
          project.result.duration,
        );
        return [
          {
            id: `camera-migrate-${Date.now()}`,
            start: 0,
            end: dur,
            x: project.camera.x,
            y: project.camera.y,
            size: project.camera.size,
          },
        ];
      }
      return [];
    })(),
    cameraMediaSegments: (() => {
      const saved = (project as SavedProject & { cameraMediaSegments?: unknown })
        .cameraMediaSegments;
      if (Array.isArray(saved) && saved.length > 0) {
        return (saved as import('../types/timeline').MediaSegment[]).map((s) => ({ ...s }));
      }
      // Migration: assume camera file covers the full timeline (single session or
      // previously-working multi-session where both had camera).
      if (project.camera?.enabled && project.result.cameraPath) {
        return mediaSegments.map((s) => ({ ...s }));
      }
      return [];
    })(),
  };
}
