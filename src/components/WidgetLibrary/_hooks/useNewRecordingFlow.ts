import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../store';
import { useProjectPersistence } from '../../ProjectPersistenceProvider';

export const useNewRecordingFlow = () => {
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const { discardPendingSave, hasUnsavedChanges, isSaving, isTitleRequired } =
    useProjectPersistence();

  const { recordingResult } = useStore(
    useShallow((s) => ({
      recordingResult: s.recordingResult,
    })),
  );

  const { resetEditorSession } = useStore(
    useShallow((s) => ({
      resetEditorSession: s.resetEditorSession,
    })),
  );

  const isUnsaved = recordingResult !== null && (hasUnsavedChanges || isSaving || isTitleRequired);

  const openNewRecording = async () => {
    if (isUnsaved) {
      setShowUnsavedWarning(true);
      return;
    }

    await window.screenforge.clearAppendMode().catch(() => undefined);
    window.screenforge.showToolbar();
  };

  const discardAndOpenNewRecording = async () => {
    discardPendingSave();
    resetEditorSession();
    setShowUnsavedWarning(false);
    await window.screenforge.clearAppendMode().catch(() => undefined);
    window.screenforge.showToolbar();
  };

  return {
    showUnsavedWarning,
    setShowUnsavedWarning,
    openNewRecording,
    discardAndOpenNewRecording,
  };
};
