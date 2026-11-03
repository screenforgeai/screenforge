/**
 * All IPC channel name constants, grouped by domain.
 * Import this in both main-process handlers and the preload bridge
 * so channel strings are never duplicated or mistyped.
 */
export const CH = {
  sources: {
    GET: 'sources:get',
  },
  recording: {
    START: 'recording:start',
    STOP: 'recording:stop',
    SAVE: 'recording:save',
    SAVE_AUDIO: 'recording:save-audio',
    SAVE_CAMERA: 'recording:save-camera',
    MERGE_AUDIO: 'recording:merge-audio',
    PAUSE: 'recording:pause',
    RESUME: 'recording:resume',
    FINISHED: 'recording:finished',
    FAILED: 'recording:failed',
    LOAD: 'recording:load',
    PROCESSING: 'recording:processing',
    HIDE_TOOLBAR: 'recording:hide-toolbar',
    STOP_REQUESTED: 'recording:stop-requested',
    DISCARD: 'recording:discard',
    ACTIVATE_APPEND_MODE: 'recording:activate-append-mode',
    GET_APPEND_MODE: 'recording:get-append-mode',
    CLEAR_APPEND_MODE: 'recording:clear-append-mode',
    CONCAT: 'recording:concat',
    REENCODE: 'recording:reencode',
    GET_BACKEND: 'recording:get-backend',
  },
  library: {
    SAVE: 'library:save',
    GET_ALL: 'library:get-all',
    DELETE: 'library:delete',
  },
  export: {
    START: 'export:start',
    CANCEL: 'export:cancel',
    PICK_PATH: 'export:pick-path',
    SUGGEST_PATH: 'export:suggest-path',
    REVEAL_IN_FOLDER: 'export:reveal-in-folder',
    PROGRESS: 'export:progress',
    CREATE_WORKSPACE: 'export:create-workspace',
    INIT_MUXER: 'export:init-muxer',
    WRITE_CHUNKS: 'export:write-chunks',
    WRITE_AUDIO: 'export:write-audio',
    CLEANUP_WORKSPACE: 'export:cleanup-workspace',
    PROBE_SOURCE: 'export:probe-source',
    GET_STATS: 'export:get-stats',
    FILE_EXISTS: 'export:file-exists',
    // ── Hidden-window capture channels ────────────────────────────────────
    // Main window → main process: "run capture in a hidden worker window"
    RUN_CAPTURE: 'export:run-capture',
    // Hidden window → main process: renderer is ready to receive capture params
    CAPTURE_READY: 'export:capture-ready',
    // Main process → hidden window: send capture params after the window loads
    CAPTURE_PARAMS: 'export:capture-params',
    // Hidden window → main process: capture progress (0–1), forwarded to main window
    CAPTURE_PROGRESS: 'export:capture-progress',
    // Hidden window → main process: capture finished successfully
    CAPTURE_DONE: 'export:capture-done',
    // Hidden window → main process: capture failed
    CAPTURE_ERROR: 'export:capture-error',
    // Main process → hidden window: abort the in-flight capture
    CAPTURE_ABORT: 'export:capture-abort',
  },
  preload: {
    PROGRESS: 'preload:progress',
  },
  updater: {
    GET_STATE: 'updater:get-state',
    CHECK_NOW: 'updater:check-now',
    STATE_CHANGED: 'updater:state-changed',
    RESTART_TO_APPLY_UPDATE: 'updater:restart-to-apply-update',
  },
  ffmpeg: {
    SETUP_STATUS: 'ffmpeg:setup-status',
    INSTALL: 'ffmpeg:install',
    INSTALL_PROGRESS: 'ffmpeg:install-progress',
    INSTALL_DONE: 'ffmpeg:install-done',
  },
  captions: {
    TRANSCRIBE: 'captions:transcribe',
    PROGRESS: 'captions:progress',
    CANCEL: 'captions:cancel',
    MODEL_STATUS: 'captions:model-status',
    EXPORT_SRT: 'captions:export-srt',
  },
  teleprompter: {
    TOGGLE: 'teleprompter:toggle',
    CLOSE: 'teleprompter:close',
    CLOSED: 'teleprompter:closed',
    READY: 'teleprompter:ready',
  },
  sceneOverlay: {
    OPEN: 'scene-overlay:open',
    CLOSE: 'scene-overlay:close',
    CLOSED: 'scene-overlay:closed',
    READY: 'scene-overlay:ready',
    RESIZE: 'scene-overlay:resize',
    UPDATE_SCENE: 'scene-overlay:update-scene',
    ON_SCENE_UPDATED: 'scene-overlay:on-scene-updated',
    OPEN_TELEPROMPTER_BELOW: 'scene-overlay:open-teleprompter-below',
    NEXT_SCENE: 'scene-overlay:next-scene',
    PREV_SCENE: 'scene-overlay:prev-scene',
  },
  settings: {
    GET: 'settings:get',
    SAVE: 'settings:save',
  },
  presets: {
    SAVE: 'presets:save',
    GET_ALL: 'presets:get-all',
    DELETE: 'presets:delete',
  },
  music: {
    PICK_FILE: 'music:pick-file',
    SAVE: 'music:save',
  },
  import: {
    PICK: 'import:pick',
    PICK_FOR_INSERT: 'import:pick-for-insert',
    TRIGGER: 'import:trigger',
  },
  cameraPreview: {
    OPEN: 'camera-preview:open',
    CLOSE: 'camera-preview:close',
    GET_DEVICE_ID: 'camera-preview:get-device-id',
  },
  areaSelector: {
    OPEN: 'area-selector:open',
    CONFIRM: 'area-selector:confirm',
    CANCEL: 'area-selector:cancel',
  },
  app: {
    SAVE_SCREENSHOT: 'app:save-screenshot',
    QUIT: 'app:quit',
    MINIMIZE_TO_DOCK: 'app:minimize-to-dock',
    SHOW_MAIN: 'app:show-main',
    SHOW_TOOLBAR: 'app:show-toolbar',
    SET_TOOLBAR_MOUSE_INTERACTIVITY: 'app:set-toolbar-mouse-interactivity',
    SET_TOOLBAR_SHAPE: 'app:set-toolbar-shape',
    SET_TOOLBAR_VIEWPORT: 'app:set-toolbar-viewport',
    FOCUS_WINDOW: 'app:focus-window',
    SYSTEM_WARNING: 'app:system-warning',
    GET_APP_VERSION: 'app:get-app-version',
    PREPARE_RECORDING_START_PERMISSIONS: 'app:prepare-recording-start-permissions',
    GET_STARTUP_PERMISSION_STATUSES: 'app:get-startup-permission-statuses',
    REQUEST_SCREEN_ACCESS: 'app:request-screen-access',
    REQUEST_MEDIA_ACCESS: 'app:request-media-access',
    IS_FEEDBACK_CONFIGURED: 'app:is-feedback-configured',
    RELAUNCH: 'app:relaunch',
    GET_LOG_FILE_PATH: 'app:get-log-file-path',
    READ_LOG_FILE: 'app:read-log-file',
    WRITE_DIAGNOSTIC_LOG: 'app:write-diagnostic-log',
    OPEN_EXTERNAL_URL: 'app:open-external-url',
    OPEN_SYSTEM_SETTINGS: 'app:open-system-settings',
    TRACK_EVENT: 'app:track-event',
    GET_ANONYMOUS_ID: 'app:get-anonymous-id',
    IDENTIFY_USER: 'app:identify-user',
  },
} as const;
