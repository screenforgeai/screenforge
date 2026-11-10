export interface PreloadProgress {
  task: string;
  completed: number;
  total: number;
}

export type StartupPermission = 'screen' | 'microphone' | 'camera' | 'accessibility';

/** An error as it crosses IPC from a renderer: Error instances don't survive structured clone intact. */
export type SerializedError = {
  name?: string;
  message: string;
  stack?: string;
  /** The renderer's PostHog chunk ids, which map its stack frames to uploaded source maps. */
  chunkIds?: Record<string, string>;
};

/** In-app feedback, sent to PostHog as a `feedback_submitted` event. */
export type FeedbackSubmission = {
  message: string;
  name?: string;
  email?: string;
  source: string;
  reportType: string;
  rating?: number;
  context?: Record<string, unknown>;
  logs?: string;
};
export type RequestableMediaPermission = 'microphone' | 'camera';
export type StartupPermissionStatus =
  | 'granted'
  | 'not-determined'
  | 'denied'
  | 'restricted'
  | 'unknown';

export type StartupPermissionMap = Record<StartupPermission, StartupPermissionStatus>;

// 'available' means a newer version exists that the user installs themselves
// (Linux, where the app can't update itself).
export type UpdaterStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'ready'
  | 'error';

export type UpdaterDisabledReason =
  | 'not_packaged'
  | 'unsupported'
  | 'not_implemented'
  | 'missing_feed';

export interface UpdaterState {
  currentVersion: string;
  status: UpdaterStatus;
  availableVersion?: string;
  releaseNotes?: string;
  reason?: UpdaterDisabledReason;
  errorMessage?: string;
}

/**
 * Which pipeline captures the screen on this machine.
 * - native: ScreenCaptureKit (macOS 13+) or WGC (Windows) helper binary
 * - ffmpeg-x11: FFmpeg grab (Linux X11, macOS < 13 AVFoundation, Windows gdigrab)
 * - wayland-portal: renderer-side getDisplayMedia via PipeWire/xdg-desktop-portal
 * - unsupported: no capture backend available (e.g. Linux with unknown session)
 */
export type CaptureBackend = 'native' | 'ffmpeg-x11' | 'wayland-portal' | 'unsupported';

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string | null;
  appIcon: string | null;
  appName?: string;
  windowTitle?: string;
}

export type ScreenshotCaptureKind = 'display' | 'window' | 'area';

/** A rectangle picked in the area selector, in DIPs of the display it was drawn on. */
export interface SelectedArea {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The display the selector covered, as it was then (DIP size). */
  display?: { id: number; width: number; height: number };
}

export interface ScreenshotCaptureRequest {
  kind: ScreenshotCaptureKind;
  /** Desktop source id ("screen:…" / "window:…"). Ignored for areas (their display decides). */
  sourceId: string;
  /** Area selection (from the area selector). */
  area?: SelectedArea | null;
}

/** A still image handed to the Screenshot editor. */
export interface ScreenshotCapture {
  /** Where it came from: a live capture, or the editor's current preview frame. */
  kind: ScreenshotCaptureKind | 'frame';
  /** PNG data URL. */
  dataUrl: string;
  width: number;
  height: number;
}

export interface WindowFocusTarget {
  appName?: string;
  windowTitle?: string;
  /** Desktop source id ("window:<id>:…") — used on Linux X11 to activate by X window id. */
  sourceId?: string;
}

export type CursorType = 'default' | 'pointer' | 'text' | 'crosshair' | 'grab' | 'resize';

export type KeyCategory =
  | 'character'
  | 'whitespace'
  | 'enter'
  | 'delete'
  | 'navigation'
  | 'modifier'
  | 'shortcut'
  | 'system'
  | 'unknown';

export interface KeyboardModifiers {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export interface CursorEvent {
  type: 'move' | 'mouseup' | 'mousedown' | 'scroll' | 'keydown' | 'keyup';
  x?: number;
  y?: number;
  deltaX?: number; // for scroll
  deltaY?: number; // for scroll
  button?: string | number;
  timestamp: number;
  cursorType?: CursorType; // populated by native cursor detection (future)
  keyCategory?: KeyCategory; // populated for keyboard events; plain typing never stores text
  keyLabel?: string; // optional safe display label for modifiers/shortcuts only
  modifiers?: KeyboardModifiers;
  repeat?: boolean;
}

export interface RecordingArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecordingBoundsSample extends RecordingArea {
  timestamp: number;
  scaleFactor?: number;
}

export interface RecordingResult {
  filePath: string;
  mouseData: CursorEvent[];
  duration: number;
  startTime: number; // Date.now() when recording began — anchor for event timestamps
  recordingArea: RecordingArea; // logical-pixel bounds of the captured area at recording start
  captureBoundsTimeline?: RecordingBoundsSample[];
  hasEmbeddedAudio?: boolean;
  audioPath?: string;
  cameraPath?: string;
  isImported?: boolean; // true for user-imported videos (no native cursor data)
}

export interface ProjectCursorSettings {
  enabled: boolean;
  style: import('../lib/effects/cursor/cursors').CursorStyle;
  clickEffect: 'ripple' | 'none';
  size: number;
  halflife: number;
  motionBlur: boolean;
  maxTilt: number;
  hideWhenIdle: boolean;
  idleHideSeconds: number;
  clickSound: 'none' | 'soft' | 'mouse' | 'trackpad' | 'pop' | 'tick';
  clickSoundVolume: number;
  continuousTracking: boolean;
}

export type CameraShape = 'square' | 'horizontal' | 'vertical';

export type CameraLayoutPreset = 'pip' | 'full' | 'left' | 'right';

export interface ProjectCameraShadowSettings {
  blur: number;
  opacity: number;
}

export interface ProjectCameraSettings {
  enabled: boolean;
  x: number;
  y: number;
  size: number;
  shape: CameraShape;
  roundness: number;
  mirror: boolean;
  zoomResponse: number;
  shadow: ProjectCameraShadowSettings;
  backgroundBlur: number;
  /** Corner radius for left/right panel layouts, in px at 1080p. */
  fixedRadius: number;
  /** Scale multiplier applied to corner radius during zoom (1.0 = no change). */
  zoomRadiusScale: number;
  /** Inset gap for left/right panel layouts, in px at 1080p. */
  fixedPadding: number;
}

export type KeyboardCaptionSize = 'small' | 'medium' | 'large';
export type KeyboardCaptionBackground = 'dark' | 'light';

export interface ProjectKeyboardSettings {
  enabled: boolean;
  position: 'bottom-center';
  opacity: number;
  size: KeyboardCaptionSize;
  background: KeyboardCaptionBackground;
}

export interface SavedProject {
  id: string;
  name: string;
  result: RecordingResult;
  zoomClips: import('./timeline').ZoomClip[];
  cameraClips?: import('./timeline').CameraClip[];
  mediaSegments?: import('./timeline').MediaSegment[];
  cameraMediaSegments?: import('./timeline').MediaSegment[];
  frame: import('../lib/effects/frame').FrameSettings;
  cursor: ProjectCursorSettings;
  camera: ProjectCameraSettings;
  keyboard: ProjectKeyboardSettings;
  captions?: CaptionSettings;
  textClips?: TextClip[];
  musicClips?: import('../lib/timeline').MusicClip[];
  maskClips?: import('./timeline').MaskClip[];
  motionClips?: import('../lib/animation/motionClips').MotionClip[];
  /** Set once clip transitions have been converted to Motion (see migrateTransitions). */
  motionVersion?: number;
  background?: import('../lib/effects/frame').BackgroundSettings;
  savedAt: string;
  thumbnail: string; // base64 data URL, empty string if none
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface StoredProjectLike extends Omit<
  SavedProject,
  'frame' | 'cursor' | 'camera' | 'keyboard'
> {
  frame?: import('../lib/effects/frame').FrameSettings;
  cursor?: Partial<ProjectCursorSettings>;
  camera?: DeepPartial<ProjectCameraSettings>;
  keyboard?: Partial<ProjectKeyboardSettings>;
}

export type ExportFormat = 'mp4' | 'mov' | 'webm' | 'gif';
export type ExportResolution = '720p' | '1080p' | '4k';
export type ExportFps = 20 | 24 | 25 | 30 | 60;
export type ExportQuality = 'fast' | 'balanced' | 'high';

// ── Hidden-window capture params ───────────────────────────────────────────
// Passed from main window → main process → hidden BrowserWindow so that
// captureTimeline() runs in its own renderer process, off the UI thread.

/** Serialisable snapshot of Zustand store fields read during export compositing. */
export interface CaptureStoreSnapshot {
  frame: unknown; // FrameSettings — typed as unknown to avoid importing renderer-only modules from electron
  zoomClips: unknown[];
  textClips: unknown[];
  camera: ProjectCameraSettings;
  keyboard: ProjectKeyboardSettings;
  cursorEnabled: boolean;
  cursorStyle: string; // CursorStyle — string union, kept as string to avoid renderer-only imports
  cursorSize: number;
  cursorClickEffect: string; // CursorClickEffect — 'ripple' | 'none'
  cursorHalflife: number;
  cursorMotionBlur: boolean;
  cursorMaxTilt: number;
  cursorHideWhenIdle: boolean;
  cursorIdleHideSeconds: number;
  captions?: CaptionSettings;
  cameraClips: unknown[];
  maskClips: unknown[];
  motionClips?: unknown[]; // MotionClip[]
}

/** Parameters sent to the hidden export-worker BrowserWindow. */
export interface CaptureWindowParams {
  workspaceId: string;
  jobId: string;
  recording: RecordingResult;
  mediaSegments: unknown[]; // MediaSegment[] — opaque to electron layer
  frame: unknown; // FrameSettings
  storeSnapshot: CaptureStoreSnapshot;
  duration: number;
  fps: number;
  sourceFps: number;
  targetWidth: number;
  targetHeight: number;
  format: ExportFormat;
  quality: ExportQuality;
  resolution: ExportResolution;
  includeAudio: boolean;
  cursor: { clickSound: string; clickSoundVolume: number };
  /** Data URL of the user-picked custom wallpaper, if active. Session-only. */
  customWallpaperDataUrl?: string | null;
  musicClips?: import('../lib/timeline').MusicClip[];
}

/** Result returned from the hidden export-worker BrowserWindow. */
export interface CaptureWindowResult {
  frameCount: number;
  audioWavBuffer?: ArrayBuffer;
  perfStats?: ExportCapturePerfStats;
}

export interface ExportCapturePerfStats {
  totalCaptureMs: number;
  decodeWaitMs: number;
  renderMs: number;
  gpuSyncMs: number;
  encodeMs: number;
  encoderFlushMs: number;
  writerBackpressureMs: number;
  audioRenderMs: number;
  batchCount: number;
  yieldedFrameCount: number;
  videoFrameCount: number;
  blackFrameCount: number;
  cameraFrameCount: number;
}

// Serialised form of WebCodecs VideoDecoderConfig — safe to transfer over IPC.
export interface SerializedDecoderConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  displayAspectWidth?: number;
  displayAspectHeight?: number;
  description?: ArrayBuffer; // AVCC extra data for H.264 / VP9 codec private data
}

// A single encoded video chunk from VideoEncoder, serialised for IPC transfer.
export interface SerializedChunk {
  data: ArrayBuffer;
  type: 'key' | 'delta';
  timestamp: number; // microseconds
  duration: number; // microseconds
}

export interface ExportSettings {
  quality: ExportQuality;
  format: ExportFormat;
  resolution: ExportResolution;
  fps: ExportFps;
  includeAudio: boolean;
  audioBitrateKbps: 96 | 128 | 192 | 256 | 320;
  burnCaptions?: boolean;
  // crf and encoderPreset removed — video encoding is now handled by VideoEncoder
}

export interface ExportRequest {
  jobId: string;
  workspaceId: string;
  // frameCount removed — FFmpeg no longer consumes a frame sequence
  effectiveFps: number;
  outputPath: string;
  settings: ExportSettings;
}

// 'capturing' = rVFC + VideoEncoder phase (renderer-side)
// 'encoding'  = FFmpeg audio-mux phase (main-process-side, now very short)
// 'rendering' = legacy label kept for getExportStats backward compat
export type ExportPhase = 'capturing' | 'encoding' | 'rendering';

export interface ExportProgress {
  jobId: string;
  phase: ExportPhase;
  time: number;
  duration?: number;
  percent?: number;
}

export interface ExportResult {
  jobId: string;
  outputPath: string;
}

export interface ExportWorkspace {
  workspaceId: string;
}

export interface ExportSourceInfo {
  fps: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface ExportRuntimeStats {
  jobId?: string;
  phase: ExportPhase;
  cpuPercent?: number;
  memoryBytes?: number;
  sampledAt: number;
}

export type ToolbarViewportMode = 'compact' | 'expanded';

/** Interactive region of the toolbar window, in window (CSS pixel) coordinates. */
export interface ToolbarShapeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium';

export interface CaptionWord {
  word: string;
  start: number;
  end: number;
}

export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  words: CaptionWord[];
  edited?: boolean;
}

export type CaptionPosition = 'bottom' | 'center' | 'top';

export interface CaptionAppearance {
  fontFamily: string;
  fontScale: number;
  bold: boolean;
  italic: boolean;
  textColor: string;
  highlightColor: string;
  textOpacity: number;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  backgroundRadius: number;
  position: CaptionPosition;
}

export interface StylePreset {
  id: string;
  name: string;
  savedAt: string;
  background: import('../lib/effects/frame').BackgroundSettings;
  cursor: ProjectCursorSettings;
  camera: ProjectCameraSettings;
  keyboard: ProjectKeyboardSettings;
  captionsAppearance: CaptionAppearance;
}

export interface CaptionSettings {
  segments: CaptionSegment[];
  model: WhisperModel;
  language: string;
  captionsEnabled: boolean;
  // Appearance
  fontFamily: string;
  fontScale: number; // 0.5–2.0 multiplier on the auto-computed size
  bold: boolean;
  italic: boolean;
  textColor: string;
  highlightColor: string;
  textOpacity: number; // 0–100
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number; // 0–100
  backgroundRadius: number; // px, 0–100 (clamped to half pill height at render)
  position: CaptionPosition;
}

export interface TextClip {
  id: string;
  start: number;
  end: number;
  content: string;

  // Position — normalized [0,1] relative to canvas dimensions
  x: number;
  y: number;
  width: number;
  height?: number; // normalized [0,1] relative to canvas height; undefined = auto-compute from content

  // Typography
  fontFamily: string;
  fontSize: number; // design px at 1080p reference; scaled by canvasHeight/1080 at render
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';

  // Text color
  color: string;
  colorOpacity: number; // 0–100

  // Background
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number; // 0–100
  backgroundRadius: number; // design px at 1080p reference
  backgroundPadding: number; // design px at 1080p reference

  // Animation
  animationIn: 'none' | 'fade' | 'slide-up' | 'slide-down';
  animationInDuration: number;
  animationOut: 'none' | 'fade' | 'slide-up' | 'slide-down';
  animationOutDuration: number;
}

export type AreaSelectorPurpose = 'record' | 'screenshot';

export interface ScreenforgeAPI {
  onPreloadProgress: (cb: (p: PreloadProgress) => void) => () => void;
  onUpdaterStateChanged: (cb: (state: UpdaterState) => void) => () => void;
  getUpdaterState: () => Promise<UpdaterState>;
  checkForUpdatesNow: () => Promise<UpdaterState>;
  getAppVersion: () => Promise<string>;
  prepareRecordingStartPermissions: () => Promise<void>;
  /** Screen access only (no Accessibility), for screenshots. */
  prepareScreenshotPermissions: () => Promise<void>;
  getStartupPermissionStatuses: () => Promise<StartupPermissionMap>;
  requestScreenAccess: () => Promise<StartupPermissionStatus>;
  requestMediaAccess: (permission: RequestableMediaPermission) => Promise<StartupPermissionStatus>;
  getLogFilePath: () => Promise<string>;
  readLogFile: () => Promise<string>;
  writeDiagnosticLog: (scope: string, payload?: unknown) => void;
  restartToApplyUpdate: () => Promise<void>;
  relaunchApp: () => void;
  openSystemSettings: (permission: StartupPermission) => void;
  getSources: () => Promise<DesktopSource[]>;
  startRecording: (
    sourceId: string,
    cropArea?: { x: number; y: number; width: number; height: number } | null,
    options?: { rendererCapture?: boolean },
  ) => Promise<void>;
  getCaptureBackend: () => Promise<CaptureBackend>;
  stopRecording: (rendererCapture?: {
    webmPath: string;
    width?: number;
    height?: number;
  }) => Promise<{
    mouseData: CursorEvent[];
    startTime: number;
    stopTime: number;
    durationMs: number;
    recordingArea: RecordingArea;
    captureBoundsTimeline?: RecordingBoundsSample[];
    hasEmbeddedAudio: boolean;
    filePath: string;
  }>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  saveRecording: (buffer: ArrayBuffer) => Promise<string>;
  saveAudioCapture: (buffer: ArrayBuffer) => Promise<string>;
  saveCameraCapture: (buffer: ArrayBuffer) => Promise<string>;
  mergeAudio: (videoPath: string, audioPath: string) => Promise<string>;
  recordingFinished: (data: RecordingResult) => void;
  recordingFailed: (message: string) => void;
  recordingProcessing: () => void;
  hideToolbar: () => void;
  onRecordingLoad: (cb: (data: RecordingResult) => void) => () => void;
  onRecordingProcessing: (cb: () => void) => () => void;
  onRecordingFailed: (cb: (message: string) => void) => () => void;
  onStopRequested: (cb: () => void) => () => void;
  activateAppendMode: () => void;
  getAppendMode: () => Promise<boolean>;
  clearAppendMode: () => Promise<void>;
  concatRecordings: (firstPath: string, secondPath: string) => Promise<string>;
  reencodeRecording: (filePath: string) => Promise<string>;
  saveProject: (project: SavedProject) => Promise<SavedProject>;
  getProjects: () => Promise<SavedProject[]>;
  importVideo: () => Promise<RecordingResult | null>;
  importVideoForInsert: () => Promise<RecordingResult | null>;
  onImportTriggeredFromTray: (cb: (result: RecordingResult) => void) => () => void;
  deleteProject: (id: string) => Promise<void>;
  getSettings: () => Promise<{
    profile: { name: string; email: string };
    language: string;
    telemetryEnabled: boolean;
  }>;
  saveSettings: (patch: {
    profile?: { name: string; email: string };
    language?: string;
    telemetryEnabled?: boolean;
  }) => Promise<{
    profile: { name: string; email: string };
    language: string;
    telemetryEnabled: boolean;
  }>;
  startExport: (request: ExportRequest) => Promise<ExportResult>;
  cancelExport: (jobId: string) => Promise<void>;
  pickExportPath: (
    defaultName: string,
    format: ExportFormat,
    preferredDir?: string,
  ) => Promise<string | null>;
  suggestExportPath: (
    defaultName: string,
    format: ExportFormat,
    preferredDir?: string,
  ) => Promise<string>;
  revealExportInFolder: (filePath: string) => Promise<void>;
  onExportProgress: (cb: (progress: ExportProgress) => void) => () => void;
  createExportWorkspace: (jobId: string) => Promise<ExportWorkspace>;
  /** Initialise the muxer for this workspace. Call before sending chunks. */
  initMuxer: (
    workspaceId: string,
    format: ExportFormat,
    decoderConfig: SerializedDecoderConfig | null,
    width: number,
    height: number,
    fps: number,
  ) => Promise<void>;
  /** Stream a batch of encoded video chunks to the muxer. Transferable. */
  writeEncodedChunks: (workspaceId: string, chunks: SerializedChunk[]) => Promise<void>;
  writeExportAudio: (workspaceId: string, buffer: ArrayBuffer) => Promise<string>;
  cleanupExportWorkspace: (workspaceId: string) => Promise<void>;
  probeExportSource: (filePath: string) => Promise<ExportSourceInfo>;
  getExportStats: (jobId?: string) => Promise<ExportRuntimeStats>;
  checkFileExists: (filePath: string) => Promise<boolean>;
  // ── Hidden-window capture ─────────────────────────────────────────────────
  /** Offload captureTimeline() to a hidden BrowserWindow so the UI never blocks. */
  runCapture: (params: CaptureWindowParams) => Promise<CaptureWindowResult>;
  /** Main window: subscribe to rendering progress forwarded from the hidden window. */
  onCaptureProgress: (cb: (value: number) => void) => () => void;
  /** Hidden window: push a rendering progress value to the main process. */
  notifyCaptureProgress: (value: number) => void;
  /** Hidden window: signal successful capture completion. */
  notifyCaptureDone: (result: CaptureWindowResult) => void;
  /** Hidden window: signal capture failure. */
  notifyCaptureError: (message: string) => void;
  /** Hidden window: signal to main process that the renderer is ready to receive params. */
  notifyCaptureReady: () => void;
  /** Hidden window: subscribe to capture params sent by the main process after load. */
  onCaptureParams: (cb: (params: CaptureWindowParams) => void) => () => void;
  /** Hidden window: subscribe to abort signals from the main process. */
  onCaptureAbort: (cb: () => void) => () => void;
  checkFFmpegStatus: () => Promise<{ available: boolean }>;
  installFFmpeg: () => void;
  onInstallProgress: (cb: (progress: { downloaded: number; total: number }) => void) => () => void;
  onInstallDone: (cb: (result: { success: boolean; error?: string }) => void) => () => void;
  transcribeAudio: (
    videoPath: string,
    model: WhisperModel,
    language: string,
  ) => Promise<CaptionSegment[]>;
  onTranscribeProgress: (
    cb: (progress: { stage: 'model-load' | 'transcribing'; progress: number }) => void,
  ) => () => void;
  cancelTranscription: () => void;
  getWhisperModelStatus: (model: WhisperModel) => Promise<{ cached: boolean }>;
  exportSrtFile: (content: string, defaultName: string) => Promise<string | null>;
  saveMusic: (
    srcPath: string,
    projectId: string,
  ) => Promise<{ filePath: string; duration: number }>;
  getPathForFile: (file: File) => string;
  openCameraPreview: (deviceId: string | null) => void;
  closeCameraPreview: () => void;
  getCameraPreviewDeviceId: () => Promise<string | null>;
  setToolbarMouseInteractivity: (interactive: boolean) => void;
  setToolbarShape: (rects: ToolbarShapeRect[]) => void;
  setToolbarViewport: (mode: ToolbarViewportMode) => void;
  focusWindow: (target: WindowFocusTarget) => void;
  showMain: () => void;
  showToolbar: () => void;
  openExternalUrl: (url: string) => void;
  systemWarning: (message: string) => void;
  trackEvent: (event: string, properties?: Record<string, unknown>) => void;
  getAnonymousId: () => Promise<string | null>;
  identifyUser: (profile: { name?: string; email?: string }) => void;
  captureException: (error: SerializedError, properties?: Record<string, unknown>) => void;
  submitFeedback: (feedback: FeedbackSubmission) => void;
  saveScreenshot: (dataUrl: string) => Promise<string>;
  captureScreenshot: (request: ScreenshotCaptureRequest) => Promise<void>;
  copyScreenshotToClipboard: (dataUrl: string) => Promise<void>;
  onScreenshotCaptured: (cb: (capture: ScreenshotCapture) => void) => () => void;
  minimizeToDock: () => void;
  quitApp: () => void;
  toggleTeleprompter: () => void;
  closeTeleprompter: () => void;
  onTeleprompterReady: (cb: () => void) => () => void;
  onTeleprompterClosed: (cb: () => void) => () => void;
  openSceneOverlay: () => void;
  closeSceneOverlay: () => void;
  resizeSceneOverlay: (height: number) => Promise<void>;
  updateSceneFromOverlay: (payload: { id: string; patch: { status: string } }) => void;
  onSceneOverlayReady: (cb: () => void) => () => void;
  onSceneOverlayClosed: (cb: () => void) => () => void;
  onSceneUpdatedFromOverlay: (
    cb: (payload: { id: string; patch: { status: string } }) => void,
  ) => () => void;
  openTeleprompterBelowOverlay: () => void;
  onSceneNextRequested: (cb: () => void) => () => void;
  onScenePrevRequested: (cb: () => void) => () => void;
  savePreset: (preset: StylePreset) => Promise<StylePreset>;
  getPresets: () => Promise<StylePreset[]>;
  deletePreset: (id: string) => Promise<void>;
  confirmAreaSelection: (area: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<void>;
  cancelAreaSelection: () => void;
  /** `purpose` picks the confirm button: record (default) or take a screenshot. */
  openAreaSelector: (purpose?: AreaSelectorPurpose) => Promise<SelectedArea | null>;
}

declare global {
  interface Window {
    screenforge: ScreenforgeAPI;
  }
}
