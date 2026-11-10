import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';
import { useProjectPersistence } from '../components/ProjectPersistenceProvider';
import { trackEvent } from '../lib/analytics';

export type SampleProjectSource = 'empty_state' | 'permissions_guide';

/**
 * Opens the bundled sample recording as a new, unsaved project. Like a fresh
 * recording, it only lands in the library once the user confirms its title.
 */
export const useSampleProject = () => {
  const { t } = useTranslation('onboarding');
  const [isOpeningSample, setIsOpeningSample] = useState(false);
  // State lags a render behind, so a double click would import twice without this.
  const inFlightRef = useRef(false);
  const { beginNewRecording, flushPendingSave } = useProjectPersistence();
  const { loadRecordingSession, setRecordingName, setActiveWidget } = useStore(
    useShallow((s) => ({
      loadRecordingSession: s.loadRecordingSession,
      setRecordingName: s.setRecordingName,
      setActiveWidget: s.setActiveWidget,
    })),
  );

  const openSampleProject = useCallback(
    async (source: SampleProjectSource) => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      setIsOpeningSample(true);
      try {
        if (useStore.getState().recordingResult && !(await flushPendingSave())) {
          return;
        }

        const result = await window.screenforge.importSampleProject();
        loadRecordingSession(result);
        setRecordingName(t('sampleProjectName'));
        // Auto-zoom is what the sample is there to show off.
        setActiveWidget('zoom');
        beginNewRecording();
        trackEvent('sample_project_opened', { source });
      } catch {
        toast.error(t('sampleProjectFailed'));
      } finally {
        inFlightRef.current = false;
        setIsOpeningSample(false);
      }
    },
    [
      beginNewRecording,
      flushPendingSave,
      loadRecordingSession,
      setActiveWidget,
      setRecordingName,
      t,
    ],
  );

  return { isOpeningSample, openSampleProject };
};
