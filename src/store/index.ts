import { create } from 'zustand';
import type { AppStore, EditableStorePatch, HistoryEntry, HistorySnapshot } from './types';
import { cloneFrameSettings } from '../lib/effects/frame';
import {
  cloneEditorSession,
  createEmptyEditorSession,
  createProjectSession,
  createRecordingSession,
  defaultClipIntro,
} from './editor-session';
import { trackEvent } from '../lib/analytics';
import { normalizeZoomClips } from '../lib/effects/zoom/clip';
import { DEFAULT_CAMERA_SETTINGS } from './defaults';
import { cloneMotionClips } from '../lib/animation/motionClips';

export type {
  AppStore,
  MusicClip,
  BackgroundType,
  BackgroundSettings,
  CaptionSettings,
  MaskClip,
  Scene,
  SceneStatus,
  TextClip,
  CursorClickEffect,
  CursorEffect,
  CursorClickSound,
  CursorStyle,
  EditorSessionState,
  EditableStorePatch,
  FrameSettings,
  HistoryEntry,
  HistoryGroup,
  HistorySnapshot,
  TimelineLayerId,
  WidgetTab,
} from './types';

const HISTORY_LIMIT = 50;
export { DEFAULT_BACKGROUND, DEFAULT_FRAME } from '../lib/effects/frame';

function cloneSnapshot(snapshot: HistorySnapshot): HistorySnapshot {
  return {
    recordingResult: snapshot.recordingResult ? { ...snapshot.recordingResult } : null,
    zoomClips: snapshot.zoomClips.map((clip) => ({ ...clip })),
    mediaSegments: snapshot.mediaSegments.map((seg) => ({ ...seg })),
    cameraMediaSegments: snapshot.cameraMediaSegments.map((seg) => ({ ...seg })),
    cursorEnabled: snapshot.cursorEnabled,
    cursorStyle: snapshot.cursorStyle,
    cursorClickEffect: snapshot.cursorClickEffect,
    cursorSize: snapshot.cursorSize,
    cursorHalflife: snapshot.cursorHalflife,
    cursorMotionBlur: snapshot.cursorMotionBlur,
    cursorMaxTilt: snapshot.cursorMaxTilt,
    cursorHideWhenIdle: snapshot.cursorHideWhenIdle,
    cursorIdleHideSeconds: snapshot.cursorIdleHideSeconds,
    cursorEffect: snapshot.cursorEffect,
    cursorClickShrink: snapshot.cursorClickShrink,
    cursorColor: snapshot.cursorColor,
    cursorLabel: snapshot.cursorLabel,
    cursorClickSound: snapshot.cursorClickSound,
    cursorClickSoundVolume: snapshot.cursorClickSoundVolume,
    cursorContinuousTracking: snapshot.cursorContinuousTracking,
    camera: {
      ...snapshot.camera,
      shadow: { ...snapshot.camera.shadow },
    },
    keyboard: { ...snapshot.keyboard },
    frame: cloneFrameSettings(snapshot.frame),
    captions: {
      ...snapshot.captions,
      // Words within a segment are treated as immutable — reference copy is sufficient
      // and avoids allocating thousands of objects on every snapshot.
      segments: snapshot.captions.segments.map((seg) => ({ ...seg })),
    },
    textClips: snapshot.textClips.map((clip) => ({ ...clip })),
    musicClips: snapshot.musicClips.map((clip) => ({ ...clip })),
    cameraClips: snapshot.cameraClips.map((c) => ({ ...c })),
    maskClips: snapshot.maskClips.map((c) => ({ ...c })),
    motionClips: cloneMotionClips(snapshot.motionClips),
  };
}

function createSnapshot(state: AppStore): HistorySnapshot {
  return cloneSnapshot({
    recordingResult: state.recordingResult,
    zoomClips: state.zoomClips,
    mediaSegments: state.mediaSegments,
    cameraMediaSegments: state.cameraMediaSegments,
    cursorEnabled: state.cursorEnabled,
    cursorStyle: state.cursorStyle,
    cursorClickEffect: state.cursorClickEffect,
    cursorSize: state.cursorSize,
    cursorHalflife: state.cursorHalflife,
    cursorMotionBlur: state.cursorMotionBlur,
    cursorMaxTilt: state.cursorMaxTilt,
    cursorHideWhenIdle: state.cursorHideWhenIdle,
    cursorIdleHideSeconds: state.cursorIdleHideSeconds,
    cursorEffect: state.cursorEffect,
    cursorClickShrink: state.cursorClickShrink,
    cursorColor: state.cursorColor,
    cursorLabel: state.cursorLabel,
    cursorClickSound: state.cursorClickSound,
    cursorClickSoundVolume: state.cursorClickSoundVolume,
    cursorContinuousTracking: state.cursorContinuousTracking,
    camera: state.camera,
    keyboard: state.keyboard,
    frame: state.frame,
    captions: state.captions,
    textClips: state.textClips,
    musicClips: state.musicClips,
    cameraClips: state.cameraClips,
    maskClips: state.maskClips,
    motionClips: state.motionClips,
  });
}

function snapshotToPatch(snapshot: HistorySnapshot): EditableStorePatch {
  return {
    recordingResult: snapshot.recordingResult ? { ...snapshot.recordingResult } : null,
    zoomClips: snapshot.zoomClips.map((clip) => ({ ...clip })),
    mediaSegments: snapshot.mediaSegments.map((seg) => ({ ...seg })),
    cameraMediaSegments: snapshot.cameraMediaSegments.map((seg) => ({ ...seg })),
    cursorEnabled: snapshot.cursorEnabled,
    cursorStyle: snapshot.cursorStyle,
    cursorClickEffect: snapshot.cursorClickEffect,
    cursorSize: snapshot.cursorSize,
    cursorHalflife: snapshot.cursorHalflife,
    cursorMotionBlur: snapshot.cursorMotionBlur,
    cursorMaxTilt: snapshot.cursorMaxTilt,
    cursorHideWhenIdle: snapshot.cursorHideWhenIdle,
    cursorIdleHideSeconds: snapshot.cursorIdleHideSeconds,
    cursorEffect: snapshot.cursorEffect,
    cursorClickShrink: snapshot.cursorClickShrink,
    cursorColor: snapshot.cursorColor,
    cursorLabel: snapshot.cursorLabel,
    cursorClickSound: snapshot.cursorClickSound,
    cursorClickSoundVolume: snapshot.cursorClickSoundVolume,
    cursorContinuousTracking: snapshot.cursorContinuousTracking,
    camera: {
      ...snapshot.camera,
      shadow: { ...snapshot.camera.shadow },
    },
    keyboard: { ...snapshot.keyboard },
    frame: cloneFrameSettings(snapshot.frame),
    captions: {
      ...snapshot.captions,
      segments: snapshot.captions.segments.map((seg) => ({ ...seg })),
    },
    textClips: snapshot.textClips.map((clip) => ({ ...clip })),
    musicClips: snapshot.musicClips.map((clip) => ({ ...clip })),
    cameraClips: snapshot.cameraClips.map((c) => ({ ...c })),
    maskClips: snapshot.maskClips.map((c) => ({ ...c })),
    motionClips: cloneMotionClips(snapshot.motionClips),
  };
}

function snapshotsEqual(a: HistorySnapshot, b: HistorySnapshot): boolean {
  if (a === b) {
    return true;
  }
  // Cheap primitive checks first — exit early on most common diffs
  if (a.recordingResult?.cameraPath !== b.recordingResult?.cameraPath) {
    return false;
  }
  if (a.cursorStyle !== b.cursorStyle) {
    return false;
  }
  if (a.cursorClickEffect !== b.cursorClickEffect) {
    return false;
  }
  if (a.cursorSize !== b.cursorSize) {
    return false;
  }
  if (a.cursorHalflife !== b.cursorHalflife) {
    return false;
  }
  if (a.cursorMotionBlur !== b.cursorMotionBlur) {
    return false;
  }
  if (a.cursorMaxTilt !== b.cursorMaxTilt) {
    return false;
  }
  if (a.cursorHideWhenIdle !== b.cursorHideWhenIdle) {
    return false;
  }
  if (a.cursorIdleHideSeconds !== b.cursorIdleHideSeconds) {
    return false;
  }
  if (
    a.cursorEffect !== b.cursorEffect ||
    a.cursorClickShrink !== b.cursorClickShrink ||
    a.cursorColor !== b.cursorColor ||
    a.cursorLabel !== b.cursorLabel
  ) {
    return false;
  }
  if (a.cursorClickSound !== b.cursorClickSound) {
    return false;
  }
  if (a.cursorClickSoundVolume !== b.cursorClickSoundVolume) {
    return false;
  }
  if (a.cursorContinuousTracking !== b.cursorContinuousTracking) {
    return false;
  }
  // Array length checks before deep comparison
  if (a.zoomClips.length !== b.zoomClips.length) {
    return false;
  }
  if (a.mediaSegments.length !== b.mediaSegments.length) {
    return false;
  }
  // Deep compare nested objects and arrays only when primitives match
  if (JSON.stringify(a.camera) !== JSON.stringify(b.camera)) {
    return false;
  }
  if (JSON.stringify(a.keyboard) !== JSON.stringify(b.keyboard)) {
    return false;
  }
  if (JSON.stringify(a.frame) !== JSON.stringify(b.frame)) {
    return false;
  }
  if (JSON.stringify(a.zoomClips) !== JSON.stringify(b.zoomClips)) {
    return false;
  }
  if (JSON.stringify(a.mediaSegments) !== JSON.stringify(b.mediaSegments)) {
    return false;
  }
  if (JSON.stringify(a.captions) !== JSON.stringify(b.captions)) {
    return false;
  }
  if (JSON.stringify(a.textClips) !== JSON.stringify(b.textClips)) {
    return false;
  }
  if (JSON.stringify(a.musicClips) !== JSON.stringify(b.musicClips)) {
    return false;
  }
  if (JSON.stringify(a.cameraClips) !== JSON.stringify(b.cameraClips)) {
    return false;
  }
  if (JSON.stringify(a.cameraMediaSegments) !== JSON.stringify(b.cameraMediaSegments)) {
    return false;
  }
  if (JSON.stringify(a.maskClips) !== JSON.stringify(b.maskClips)) {
    return false;
  }
  if (JSON.stringify(a.motionClips) !== JSON.stringify(b.motionClips)) {
    return false;
  }
  return true;
}

function trimPast(entries: HistoryEntry[]): HistoryEntry[] {
  if (entries.length <= HISTORY_LIMIT) {
    return entries;
  }

  return entries.slice(entries.length - HISTORY_LIMIT);
}

export const useStore = create<AppStore>((set, get) => {
  const clearHistoryState = {
    past: [],
    future: [],
    activeGroup: null,
    canUndo: false,
    canRedo: false,
    isApplyingHistory: false,
  } as const;

  const defaultHiddenLayers = {
    video: false,
    audio: false,
    zoom: false,
    camera: false,
    mask: false,
    motion: false,
    text: false,
  } as const;

  const seedEditorSession = (session: ReturnType<typeof cloneEditorSession>) => {
    set({
      ...session,
      ...clearHistoryState,
      hiddenLayers: { ...defaultHiddenLayers },
    });
  };

  const finalizeHistoryGroup = (key?: string) => {
    const state = get();
    const group = state.activeGroup;

    if (!group) {
      return;
    }

    if (key && group.key !== key) {
      return;
    }

    if (!group.before) {
      set({ activeGroup: null });
      return;
    }

    const current = createSnapshot(get());
    if (snapshotsEqual(group.before, current)) {
      set({ activeGroup: null });
      return;
    }

    const nextPast = trimPast([...state.past, { label: group.label, snapshot: group.before }]);

    set({
      past: nextPast,
      future: [],
      activeGroup: null,
      canUndo: nextPast.length > 0,
      canRedo: false,
      editVersion: state.editVersion + 1,
    });
  };

  return {
    ...createEmptyEditorSession(),
    scenes: [],
    isProcessing: false,
    recordingCount: 0,
    isAppendMode: false,
    appendStartTime: null,
    processingSegment: null,
    pendingSeekTime: null,
    pendingPauseSeekTime: null,
    pendingPlayFromStartToken: null,
    savedProjects: [],
    activeWidget: 'recordings',
    hiddenLayers: {
      video: false,
      audio: false,
      zoom: false,
      camera: false,
      mask: false,
      motion: false,
    },
    focusMode: false,
    isExporting: false,
    screenshotCapture: null,
    past: [],
    future: [],
    activeGroup: null,
    isApplyingHistory: false,
    canUndo: false,
    canRedo: false,
    editVersion: 0,

    setScenes: (scenes) => set({ scenes }),
    addScene: (data) => {
      const id = crypto.randomUUID();
      const scenes = get().scenes;
      set({
        scenes: [...scenes, { id, order: scenes.length, status: 'planned' as const, ...data }],
      });
      return id;
    },
    updateScene: (id, patch) =>
      set({ scenes: get().scenes.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
    deleteScene: (id) => {
      const filtered = get().scenes.filter((s) => s.id !== id);
      set({ scenes: filtered.map((s, i) => ({ ...s, order: i })) });
    },
    reorderScenes: (fromIndex, toIndex) => {
      const items = [...get().scenes];
      const [moved] = items.splice(fromIndex, 1);
      if (moved) {
        items.splice(toIndex, 0, moved);
      }
      set({ scenes: items.map((s, i) => ({ ...s, order: i })) });
    },
    setRecordingResult: (result) => set({ recordingResult: result }),
    setIsProcessing: (v) => set({ isProcessing: v }),
    setRecordingName: (name) =>
      set((s) => ({ recordingName: name, editVersion: s.editVersion + 1 })),
    setRecordingCount: (count) => set({ recordingCount: count }),
    incrementRecordingCount: () => set((state) => ({ recordingCount: state.recordingCount + 1 })),
    setCurrentProjectId: (id) => set({ currentProjectId: id }),
    setSavedProjects: (projects) => set({ savedProjects: projects }),
    setSelectedClip: (action) => set({ selectedClip: action }),
    setZoom: (clips) => set({ zoomClips: normalizeZoomClips(clips) }),
    setMediaSegments: (segments) => set({ mediaSegments: segments }),
    setIsGapPlayback: (v) => set({ isGapPlayback: v }),
    setCurrentTime: (t) => set({ currentTime: t }),
    requestSeekTo: (t) => set({ pendingSeekTime: t }),
    clearPendingSeek: () => set({ pendingSeekTime: null }),
    requestPauseAndSeekTo: (t) => set({ pendingPauseSeekTime: t }),
    clearPendingPauseSeek: () => set({ pendingPauseSeekTime: null }),
    requestPlayFromStart: () =>
      set((state) => ({
        pendingPlayFromStartToken: (state.pendingPlayFromStartToken ?? 0) + 1,
      })),
    clearPendingPlayFromStart: () => set({ pendingPlayFromStartToken: null }),
    setCursorStyle: (style) => set({ cursorStyle: style }),
    setCursorClickEffect: (effect) => set({ cursorClickEffect: effect }),
    setCursorSize: (size) => set({ cursorSize: size }),
    setCursorHalflife: (v) => set({ cursorHalflife: v }),
    setCursorMotionBlur: (v) => set({ cursorMotionBlur: v }),
    setCursorMaxTilt: (v) => set({ cursorMaxTilt: v }),
    setCursorHideWhenIdle: (v) => set({ cursorHideWhenIdle: v }),
    setCursorIdleHideSeconds: (v) => set({ cursorIdleHideSeconds: v }),
    setCursorClickSound: (sound) => set({ cursorClickSound: sound }),
    setCursorClickSoundVolume: (v) => set({ cursorClickSoundVolume: v }),
    setCamera: (camera) =>
      set({
        camera: {
          ...camera,
          shadow: { ...camera.shadow },
        },
      }),
    setKeyboard: (keyboard) => set({ keyboard: { ...keyboard } }),
    setFrame: (frame) => set({ frame: cloneFrameSettings(frame) }),
    setCaptions: (captions) =>
      set((s) => ({
        captions: {
          ...captions,
          segments: captions.segments.map((seg) => ({ ...seg })),
        },
        editVersion: s.editVersion + 1,
      })),
    setTextClips: (clips) => set({ textClips: clips.map((c) => ({ ...c })) }),
    setMusicClips: (clips) =>
      set((s) => ({ musicClips: clips.map((c) => ({ ...c })), editVersion: s.editVersion + 1 })),
    setMaskClips: (clips) => set({ maskClips: clips.map((c) => ({ ...c })) }),
    setActiveWidget: (tab) =>
      set(() => ({
        activeWidget: tab,
        // Both crop editors (the crop box, the recorded toolbar line) live in Frame.
        ...(tab !== 'frame' ? { isCropEditing: false } : {}),
      })),
    setFocusMode: (v) => set({ focusMode: v }),
    setIsExporting: (v) => set({ isExporting: v }),
    openScreenshotEditor: (capture) => set({ screenshotCapture: capture }),
    closeScreenshotEditor: () => set({ screenshotCapture: null }),
    setIsCropEditing: (v, target = 'frame') =>
      set(v ? { isCropEditing: true, cropEditTarget: target } : { isCropEditing: false }),
    setLayerHidden: (layer, hidden) =>
      set((state) => ({ hiddenLayers: { ...state.hiddenLayers, [layer]: hidden } })),
    setIsAppendMode: (v) => set({ isAppendMode: v }),
    setAppendStartTime: (t) => set({ appendStartTime: t }),
    setProcessingSegment: (seg) => set({ processingSegment: seg }),
    appendRecordingSession: (
      mergedResult,
      nextSegments,
      nextCameraClips,
      nextCameraMediaSegments,
    ) => {
      const state = get();
      const before = createSnapshot(state);
      const nextPast = trimPast([...state.past, { label: 'Append recording', snapshot: before }]);
      const knownIds = new Set(state.mediaSegments.map((s) => s.id));
      const newClipIntros = nextSegments.filter((s) => !knownIds.has(s.id)).map(defaultClipIntro);
      set({
        recordingResult: mergedResult,
        mediaSegments: nextSegments,
        motionClips: [...state.motionClips, ...newClipIntros],
        ...(nextCameraMediaSegments !== undefined
          ? { cameraMediaSegments: nextCameraMediaSegments }
          : {}),
        ...(nextCameraClips !== undefined ? { cameraClips: nextCameraClips } : {}),
        ...(nextCameraClips && nextCameraClips.length > 0
          ? {
              camera: {
                ...state.camera,
                enabled: true,
                // When camera is enabled for the first time via record-more, reset
                // position and appearance to defaults (mirrors what a first recording gets).
                ...(!state.camera.enabled
                  ? {
                      x: DEFAULT_CAMERA_SETTINGS.x,
                      y: DEFAULT_CAMERA_SETTINGS.y,
                      size: DEFAULT_CAMERA_SETTINGS.size,
                      roundness: DEFAULT_CAMERA_SETTINGS.roundness,
                    }
                  : {}),
              },
            }
          : {}),
        isAppendMode: false,
        appendStartTime: null,
        processingSegment: null,
        past: nextPast,
        future: [],
        canUndo: nextPast.length > 0,
        canRedo: false,
        editVersion: state.editVersion + 1,
      });
    },
    resetEditorSession: () => {
      seedEditorSession(cloneEditorSession(createEmptyEditorSession()));
    },
    loadRecordingSession: (result) => {
      seedEditorSession(cloneEditorSession(createRecordingSession(result)));
    },
    loadProjectSession: (project) => {
      seedEditorSession(cloneEditorSession(createProjectSession(project)));
    },

    beginHistoryGroup: (key, label) => {
      const existing = get().activeGroup;

      if (existing?.key === key) {
        return;
      }

      if (existing) {
        finalizeHistoryGroup(existing.key);
      }

      set({ activeGroup: { key, label, before: null } });
    },

    endHistoryGroup: (key) => {
      finalizeHistoryGroup(key);
    },

    commitEdit: (label, mutator) => {
      const current = get();
      const patch = mutator(current);
      if (!patch || Object.keys(patch).length === 0) {
        return;
      }

      if (current.isApplyingHistory) {
        set(patch);
        return;
      }

      const group = current.activeGroup;
      if (group) {
        if (!group.before) {
          set({
            activeGroup: {
              ...group,
              before: createSnapshot(current),
              label: group.label || label,
            },
          });
        }
        set(patch);
        return;
      }

      const before = createSnapshot(current);
      set(patch);
      // Check only the patched fields against the before-snapshot to detect no-ops
      // without creating a second full deep clone of the entire state.
      const afterState = get();
      const hasChange = Object.keys(patch).some((key) => {
        // selectedClip and other non-history fields won't be in the snapshot
        if (!(key in before)) {
          return false;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (before as any)[key] !== (afterState as any)[key];
      });
      if (!hasChange) {
        return;
      }

      // `before` is a freshly allocated snapshot — push it directly without re-cloning.
      const nextPast = trimPast([...afterState.past, { label, snapshot: before }]);
      set({
        past: nextPast,
        future: [],
        canUndo: nextPast.length > 0,
        canRedo: false,
        editVersion: afterState.editVersion + 1,
      });
    },

    undo: () => {
      if (get().activeGroup) {
        finalizeHistoryGroup(get().activeGroup?.key);
      }

      const state = get();
      if (state.past.length === 0) {
        return;
      }

      const entry = state.past[state.past.length - 1];
      trackEvent('undo_triggered', { action_label: entry.label });
      const currentSnapshot = createSnapshot(state);
      const nextPast = state.past.slice(0, -1);
      const nextFuture = [{ label: entry.label, snapshot: currentSnapshot }, ...state.future];

      set({ isApplyingHistory: true });
      set({
        ...snapshotToPatch(entry.snapshot),
        selectedClip: null,
        past: nextPast,
        future: nextFuture,
        activeGroup: null,
        canUndo: nextPast.length > 0,
        canRedo: nextFuture.length > 0,
        isApplyingHistory: false,
        editVersion: state.editVersion + 1,
      });
    },

    redo: () => {
      if (get().activeGroup) {
        finalizeHistoryGroup(get().activeGroup?.key);
      }

      const state = get();
      if (state.future.length === 0) {
        return;
      }

      const entry = state.future[0];
      trackEvent('redo_triggered', { action_label: entry.label });
      const currentSnapshot = createSnapshot(state);
      const nextPast = trimPast([...state.past, { label: entry.label, snapshot: currentSnapshot }]);
      const nextFuture = state.future.slice(1);

      set({ isApplyingHistory: true });
      set({
        ...snapshotToPatch(entry.snapshot),
        selectedClip: null,
        past: nextPast,
        future: nextFuture,
        activeGroup: null,
        canUndo: nextPast.length > 0,
        canRedo: nextFuture.length > 0,
        isApplyingHistory: false,
        editVersion: state.editVersion + 1,
      });
    },

    clearHistoryAndSeed: () => set(clearHistoryState),
  };
});
