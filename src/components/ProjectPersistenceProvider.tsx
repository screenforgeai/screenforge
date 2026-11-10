import * as React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { captureProjectThumbnail } from 'src/lib/utils';
import { getStrictContext } from 'src/lib/get-strict-context';
import { createProjectSnapshotFromState } from 'src/lib/project-snapshot';
import { useStore, type AppStore } from '../store';
import type { SavedProject } from '../types';
import { MOTION_VERSION } from '../lib/animation/migrateTransitions';

const AUTOSAVE_DELAY_MS = 5_000;
const SAVE_STATUS_LINGER_MS = 3000;

type ProjectPersistenceContextValue = {
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  isTitleRequired: boolean;
  titlePopoverOpen: boolean;
  openTitleEditor: () => void;
  closeTitleEditor: () => void;
  submitTitle: (name: string) => Promise<boolean>;
  flushPendingSave: () => Promise<boolean>;
  discardPendingSave: () => void;
  beginNewRecording: () => void;
  setLoadedProject: (project: SavedProject) => void;
};

const [ProjectPersistenceProviderBase, useProjectPersistence] =
  getStrictContext<ProjectPersistenceContextValue>('ProjectPersistenceProvider');

type ProjectPersistenceProviderProps = {
  children: React.ReactNode;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
};

function buildProjectFromState(
  state: AppStore,
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  thumbnailOverride?: string | null,
): SavedProject | null {
  if (!state.recordingResult) {
    return null;
  }

  const snapshot = createProjectSnapshotFromState(state);
  if (!snapshot) {
    return null;
  }

  const thumbnail = captureProjectThumbnail({
    canvas: canvasRef.current,
    video: videoRef.current,
    existingThumbnail: thumbnailOverride,
  });

  return {
    id: state.currentProjectId ?? `proj-${Date.now()}`,
    name: snapshot.recordingName,
    result: snapshot.recordingResult,
    zoomClips: snapshot.zoomClips,
    zoomStyle: snapshot.zoomStyle,
    mediaSegments: snapshot.mediaSegments,
    frame: snapshot.frame,
    cursor: snapshot.cursor,
    camera: snapshot.camera,
    cameraClips: snapshot.cameraClips,
    cameraMediaSegments: snapshot.cameraMediaSegments,
    keyboard: snapshot.keyboard,
    captions: snapshot.captions,
    textClips: snapshot.textClips,
    musicClips: snapshot.musicClips,
    maskClips: snapshot.maskClips,
    motionClips: snapshot.motionClips,
    motionVersion: MOTION_VERSION,
    savedAt: new Date().toISOString(),
    thumbnail,
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Save failed';
}

const ProjectPersistenceProvider = ({
  children,
  videoRef,
  canvasRef,
}: ProjectPersistenceProviderProps) => {
  // Subscribe only to the fields needed to drive save logic. Unsaved-change
  // detection uses editVersion (O(1) counter) instead of JSON.stringify on 22
  // fields, which was blocking the render thread on every slider drag.
  const { recordingResult, editVersion } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      editVersion: state.editVersion,
    })),
  );

  const { setCurrentProjectId, setSavedProjects, setRecordingName } = useStore(
    useShallow((state) => ({
      setCurrentProjectId: state.setCurrentProjectId,
      setSavedProjects: state.setSavedProjects,
      setRecordingName: state.setRecordingName,
    })),
  );

  const [isSaving, setIsSaving] = React.useState(false);
  const [isTitleRequired, setIsTitleRequired] = React.useState(false);
  const [titlePopoverOpen, setTitlePopoverOpen] = React.useState(false);
  // Tracks the editVersion at the time of the last successful save. null means
  // this session has never been saved (new recording, no persisted baseline).
  const [lastPersistedEditVersion, setLastPersistedEditVersion] = React.useState<number | null>(
    null,
  );

  const saveTimerRef = React.useRef<number | null>(null);
  const saveStatusTimerRef = React.useRef<number | null>(null);
  const inFlightSaveRef = React.useRef<Promise<boolean> | null>(null);
  const sessionRef = React.useRef(0);

  // O(1) unsaved-change detection via editVersion counter — avoids the previous
  // JSON.stringify on up to 22 store fields that ran synchronously on every edit.
  const hasUnsavedChanges = Boolean(
    recordingResult &&
    lastPersistedEditVersion !== null &&
    editVersion !== lastPersistedEditVersion,
  );

  const clearPendingTimer = React.useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const clearSaveStatusTimer = React.useCallback(() => {
    if (saveStatusTimerRef.current !== null) {
      window.clearTimeout(saveStatusTimerRef.current);
      saveStatusTimerRef.current = null;
    }
  }, []);

  const runSave = React.useCallback(async () => {
    clearPendingTimer();

    const state = useStore.getState();
    const existingProject = state.currentProjectId
      ? (state.savedProjects.find((item) => item.id === state.currentProjectId) ?? null)
      : null;
    const project = buildProjectFromState(
      state,
      videoRef,
      canvasRef,
      existingProject?.thumbnail ?? null,
    );
    if (!project) {
      return false;
    }
    // Capture the editVersion at the moment we snapshot state for saving. If
    // the user makes more edits while the async save is in flight, those will
    // have a higher version and hasUnsavedChanges will correctly stay true.
    const editVersionAtSave = useStore.getState().editVersion;

    const sessionAtStart = sessionRef.current;
    clearSaveStatusTimer();
    setIsSaving(true);

    try {
      const saved = await window.screenforge.saveProject(project);

      if (sessionRef.current !== sessionAtStart) {
        return false;
      }

      const freshProjects = useStore.getState().savedProjects;
      const existingProjectIndex = freshProjects.findIndex((item) => item.id === saved.id);

      if (existingProjectIndex === -1) {
        setSavedProjects([saved, ...freshProjects]);
      } else {
        const nextProjects = [...freshProjects];
        nextProjects[existingProjectIndex] = saved;
        setSavedProjects(nextProjects);
      }
      setCurrentProjectId(saved.id);
      setLastPersistedEditVersion(editVersionAtSave);
      setIsTitleRequired(false);
      setTitlePopoverOpen(false);
      return true;
    } catch (error) {
      if (sessionRef.current === sessionAtStart) {
        toast.error(getErrorMessage(error));
      }
      return false;
    } finally {
      if (sessionRef.current === sessionAtStart) {
        saveStatusTimerRef.current = window.setTimeout(() => {
          if (sessionRef.current === sessionAtStart) {
            setIsSaving(false);
          }
          saveStatusTimerRef.current = null;
        }, SAVE_STATUS_LINGER_MS);
      }
    }
  }, [
    canvasRef,
    clearPendingTimer,
    clearSaveStatusTimer,
    setCurrentProjectId,
    setSavedProjects,
    videoRef,
  ]);

  const queueSave = React.useCallback(() => {
    if (!inFlightSaveRef.current) {
      const request = runSave().finally(() => {
        if (inFlightSaveRef.current === request) {
          inFlightSaveRef.current = null;
        }
      });
      inFlightSaveRef.current = request;
    }

    return inFlightSaveRef.current;
  }, [runSave]);

  const openTitleEditor = React.useCallback(() => {
    if (useStore.getState().recordingResult) {
      setTitlePopoverOpen(true);
    }
  }, []);

  const closeTitleEditor = React.useCallback(() => {
    if (!isTitleRequired) {
      setTitlePopoverOpen(false);
    }
  }, [isTitleRequired]);

  const flushPendingSave = React.useCallback(async () => {
    clearPendingTimer();

    if (isTitleRequired) {
      return false;
    }

    if (inFlightSaveRef.current) {
      return inFlightSaveRef.current;
    }

    if (!hasUnsavedChanges) {
      return true;
    }

    return queueSave();
  }, [clearPendingTimer, hasUnsavedChanges, isTitleRequired, queueSave]);

  const discardPendingSave = React.useCallback(() => {
    sessionRef.current += 1;
    clearPendingTimer();
    clearSaveStatusTimer();
    inFlightSaveRef.current = null;
    setIsSaving(false);
    setIsTitleRequired(false);
    setTitlePopoverOpen(false);
    setLastPersistedEditVersion(null);
  }, [clearPendingTimer, clearSaveStatusTimer]);

  const beginNewRecording = React.useCallback(() => {
    sessionRef.current += 1;
    clearPendingTimer();
    clearSaveStatusTimer();
    inFlightSaveRef.current = null;
    setIsSaving(false);
    setLastPersistedEditVersion(null);
    setIsTitleRequired(true);
    setTitlePopoverOpen(true);
  }, [clearPendingTimer, clearSaveStatusTimer]);

  const setLoadedProject = React.useCallback(
    (_project: SavedProject) => {
      sessionRef.current += 1;
      clearPendingTimer();
      clearSaveStatusTimer();
      inFlightSaveRef.current = null;
      setIsSaving(false);
      setIsTitleRequired(false);
      setTitlePopoverOpen(false);
      // Mark the current editVersion as the persisted baseline so the loaded
      // project starts with hasUnsavedChanges === false.
      setLastPersistedEditVersion(useStore.getState().editVersion);
    },
    [clearPendingTimer, clearSaveStatusTimer],
  );

  const submitTitle = React.useCallback(
    async (name: string) => {
      const shouldAutoplayAfterSave = isTitleRequired;
      setRecordingName(name);
      const didSave = await queueSave();
      if (didSave && shouldAutoplayAfterSave) {
        useStore.getState().requestPlayFromStart();
      }
      return didSave;
    },
    [isTitleRequired, queueSave, setRecordingName],
  );

  React.useEffect(() => {
    if (
      !recordingResult ||
      lastPersistedEditVersion === null ||
      !hasUnsavedChanges ||
      isTitleRequired ||
      isSaving
    ) {
      clearPendingTimer();
      return;
    }

    saveTimerRef.current = window.setTimeout(() => {
      void queueSave();
    }, AUTOSAVE_DELAY_MS);

    return clearPendingTimer;
  }, [
    clearPendingTimer,
    hasUnsavedChanges,
    isSaving,
    isTitleRequired,
    lastPersistedEditVersion,
    queueSave,
    recordingResult,
  ]);

  React.useEffect(
    () => () => {
      clearPendingTimer();
      clearSaveStatusTimer();
    },
    [clearPendingTimer, clearSaveStatusTimer],
  );

  return (
    <ProjectPersistenceProviderBase
      value={{
        isSaving,
        hasUnsavedChanges,
        isTitleRequired,
        titlePopoverOpen,
        openTitleEditor,
        closeTitleEditor,
        submitTitle,
        flushPendingSave,
        discardPendingSave,
        beginNewRecording,
        setLoadedProject,
      }}
    >
      {children}
    </ProjectPersistenceProviderBase>
  );
};

export { ProjectPersistenceProvider, useProjectPersistence };
