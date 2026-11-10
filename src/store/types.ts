import type {
  ProjectCameraSettings,
  ProjectKeyboardSettings,
  RecordingResult,
  SavedProject,
  ScreenshotCapture,
  CaptionSettings,
  TextClip,
} from '../types/index';
import type {
  CameraClip,
  MaskClip,
  SelectedZoomAction,
  ZoomClip,
  MediaSegment,
} from '../types/timeline';
import type { CursorStyle as BaseCursorStyle } from '../lib/effects/cursor/cursors';
import type { BackgroundSettings, BackgroundType, FrameSettings } from '../lib/effects/frame';
import type { MusicClip } from '../lib/timeline';
import type { MotionClip } from '../lib/animation/motionClips';

export type { MusicClip };

export type CursorStyle = BaseCursorStyle;
export type CursorClickEffect = 'ripple' | 'none';
export type CursorClickSound = 'none' | 'soft' | 'mouse' | 'trackpad' | 'pop' | 'tick';
export type WidgetTab =
  | 'recordings'
  | 'video'
  | 'zoom'
  | 'camera'
  | 'mask'
  | 'cursor'
  | 'frame'
  | 'keyboard'
  | 'captions'
  | 'text'
  | 'music'
  | 'motion';

export type SceneStatus = 'planned' | 'recorded' | 'done';

export interface Scene {
  id: string;
  title: string;
  context: string;
  duration?: string;
  notes?: string;
  script?: string;
  order: number;
  status: SceneStatus;
  startTime?: number;
  endTime?: number;
}
export type { BackgroundSettings, BackgroundType, FrameSettings, CaptionSettings, TextClip };
export type { CameraClip, MaskClip };

export interface EditorSessionState {
  recordingResult: RecordingResult | null;
  recordingName: string;
  currentProjectId: string | null;
  selectedClip: SelectedZoomAction;
  zoomClips: ZoomClip[];
  mediaSegments: MediaSegment[];
  cameraMediaSegments: MediaSegment[];
  isGapPlayback: boolean;
  currentTime: number;
  cursorEnabled: boolean;
  cursorStyle: CursorStyle;
  cursorClickEffect: CursorClickEffect;
  cursorSize: number;
  cursorHalflife: number;
  cursorMotionBlur: boolean;
  cursorMaxTilt: number;
  cursorHideWhenIdle: boolean;
  cursorIdleHideSeconds: number;
  cursorClickSound: CursorClickSound;
  cursorClickSoundVolume: number;
  cursorContinuousTracking: boolean;
  camera: ProjectCameraSettings;
  keyboard: ProjectKeyboardSettings;
  frame: FrameSettings;
  captions: CaptionSettings;
  textClips: TextClip[];
  musicClips: MusicClip[];
  cameraClips: CameraClip[];
  maskClips: MaskClip[];
  motionClips: MotionClip[];
  isCropEditing: boolean;
}

export interface HistorySnapshot {
  recordingResult: import('../types/index').RecordingResult | null;
  zoomClips: ZoomClip[];
  mediaSegments: MediaSegment[];
  cameraMediaSegments: MediaSegment[];
  cursorEnabled: boolean;
  cursorStyle: CursorStyle;
  cursorClickEffect: CursorClickEffect;
  cursorSize: number;
  cursorHalflife: number;
  cursorMotionBlur: boolean;
  cursorMaxTilt: number;
  cursorHideWhenIdle: boolean;
  cursorIdleHideSeconds: number;
  cursorClickSound: CursorClickSound;
  cursorClickSoundVolume: number;
  cursorContinuousTracking: boolean;
  camera: ProjectCameraSettings;
  keyboard: ProjectKeyboardSettings;
  frame: FrameSettings;
  captions: CaptionSettings;
  textClips: TextClip[];
  musicClips: MusicClip[];
  cameraClips: CameraClip[];
  maskClips: MaskClip[];
  motionClips: MotionClip[];
}

export interface HistoryEntry {
  label: string;
  snapshot: HistorySnapshot;
}

export interface HistoryGroup {
  key: string;
  label: string;
  before: HistorySnapshot | null;
}

export interface EditableStorePatch {
  recordingResult?: import('../types/index').RecordingResult | null;
  zoomClips?: ZoomClip[];
  mediaSegments?: MediaSegment[];
  cameraMediaSegments?: MediaSegment[];
  cursorEnabled?: boolean;
  cursorStyle?: CursorStyle;
  cursorClickEffect?: CursorClickEffect;
  cursorSize?: number;
  cursorHalflife?: number;
  cursorMotionBlur?: boolean;
  cursorMaxTilt?: number;
  cursorHideWhenIdle?: boolean;
  cursorIdleHideSeconds?: number;
  cursorClickSound?: CursorClickSound;
  cursorClickSoundVolume?: number;
  cursorContinuousTracking?: boolean;
  camera?: ProjectCameraSettings;
  keyboard?: ProjectKeyboardSettings;
  frame?: FrameSettings;
  captions?: CaptionSettings;
  textClips?: TextClip[];
  musicClips?: MusicClip[];
  cameraClips?: CameraClip[];
  maskClips?: MaskClip[];
  motionClips?: MotionClip[];
  selectedClip?: SelectedZoomAction;
}

export type TimelineLayerId =
  | 'video'
  | 'audio'
  | 'zoom'
  | 'camera'
  | 'mask'
  | 'text'
  | 'music'
  | 'motion';

export interface AppStore extends EditorSessionState {
  scenes: Scene[];
  isProcessing: boolean;
  recordingCount: number;
  isAppendMode: boolean;
  appendStartTime: number | null;
  processingSegment: { timelineStart: number; timelineEnd: number } | null;
  pendingSeekTime: number | null;
  pendingPauseSeekTime: number | null;
  pendingPlayFromStartToken: number | null;
  savedProjects: SavedProject[];
  activeWidget: WidgetTab;
  hiddenLayers: Record<TimelineLayerId, boolean>;
  focusMode: boolean;
  isExporting: boolean;
  /** Still being edited in the Screenshot editor (UI state, never persisted). */
  screenshotCapture: ScreenshotCapture | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  activeGroup: HistoryGroup | null;
  isApplyingHistory: boolean;
  canUndo: boolean;
  canRedo: boolean;
  // Monotonically incrementing counter — bumped on every mutation that changes
  // serializable project state. Used by ProjectPersistenceProvider to detect
  // unsaved changes in O(1) without calling JSON.stringify on every edit.
  editVersion: number;

  setScenes: (scenes: Scene[]) => void;
  addScene: (data: Pick<Scene, 'title' | 'context' | 'duration' | 'notes' | 'script'>) => string;
  updateScene: (id: string, patch: Partial<Omit<Scene, 'id' | 'order'>>) => void;
  deleteScene: (id: string) => void;
  reorderScenes: (fromIndex: number, toIndex: number) => void;
  setRecordingResult: (result: RecordingResult | null) => void;
  setIsProcessing: (v: boolean) => void;
  setRecordingName: (name: string) => void;
  setRecordingCount: (count: number) => void;
  incrementRecordingCount: () => void;
  setCurrentProjectId: (id: string | null) => void;
  setSavedProjects: (projects: SavedProject[]) => void;
  setSelectedClip: (action: SelectedZoomAction) => void;
  setZoom: (clips: ZoomClip[]) => void;
  setMediaSegments: (segments: MediaSegment[]) => void;
  setIsGapPlayback: (v: boolean) => void;
  setCurrentTime: (t: number) => void;
  requestSeekTo: (t: number) => void;
  clearPendingSeek: () => void;
  requestPauseAndSeekTo: (t: number) => void;
  clearPendingPauseSeek: () => void;
  requestPlayFromStart: () => void;
  clearPendingPlayFromStart: () => void;
  setCursorStyle: (style: CursorStyle) => void;
  setCursorClickEffect: (effect: CursorClickEffect) => void;
  setCursorSize: (size: number) => void;
  setCursorHalflife: (v: number) => void;
  setCursorMotionBlur: (v: boolean) => void;
  setCursorMaxTilt: (v: number) => void;
  setCursorHideWhenIdle: (v: boolean) => void;
  setCursorIdleHideSeconds: (v: number) => void;
  setCursorClickSound: (sound: CursorClickSound) => void;
  setCursorClickSoundVolume: (v: number) => void;
  setCamera: (camera: ProjectCameraSettings) => void;
  setKeyboard: (keyboard: ProjectKeyboardSettings) => void;
  setFrame: (frame: FrameSettings) => void;
  setCaptions: (captions: CaptionSettings) => void;
  setTextClips: (clips: TextClip[]) => void;
  setMusicClips: (clips: MusicClip[]) => void;
  setMaskClips: (clips: MaskClip[]) => void;
  setActiveWidget: (tab: WidgetTab) => void;
  setFocusMode: (v: boolean) => void;
  setIsExporting: (v: boolean) => void;
  openScreenshotEditor: (capture: ScreenshotCapture) => void;
  closeScreenshotEditor: () => void;
  setIsCropEditing: (v: boolean) => void;
  setLayerHidden: (layer: TimelineLayerId, hidden: boolean) => void;
  setIsAppendMode: (v: boolean) => void;
  setAppendStartTime: (t: number | null) => void;
  setProcessingSegment: (seg: { timelineStart: number; timelineEnd: number } | null) => void;
  appendRecordingSession: (
    mergedResult: RecordingResult,
    nextSegments: MediaSegment[],
    nextCameraClips?: CameraClip[],
    nextCameraMediaSegments?: MediaSegment[],
  ) => void;
  resetEditorSession: () => void;
  loadRecordingSession: (result: RecordingResult) => void;
  loadProjectSession: (project: SavedProject) => void;
  beginHistoryGroup: (key: string, label: string) => void;
  endHistoryGroup: (key: string) => void;
  commitEdit: (label: string, mutator: (state: AppStore) => EditableStorePatch | void) => void;
  undo: () => void;
  redo: () => void;
  clearHistoryAndSeed: () => void;
}
