import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useProjectPersistence } from 'src/components/ProjectPersistenceProvider';
import { trackEvent } from 'src/lib/analytics';
import { describeProjectEvent } from 'src/lib/director/projectEvents';
import { useStore } from '../store';

const TOAST_ID = 'director-project';

/**
 * Follows a Director recording (or project bundle) being opened (#28): shows
 * its progress, and opens the project once it's in the library. An untitled
 * new recording is never replaced: the project waits in Recordings.
 */
export function useDirectorProjectEvents(): void {
  const { t } = useTranslation('recordings');
  const { flushPendingSave, isTitleRequired, setLoadedProject } = useProjectPersistence();
  const { setSavedProjects, loadProjectSession } = useStore(
    useShallow((s) => ({
      setSavedProjects: s.setSavedProjects,
      loadProjectSession: s.loadProjectSession,
    })),
  );

  useEffect(() => {
    return window.screenforge.onDirectorProjectEvent((event) => {
      const display = describeProjectEvent(event);
      const message = String(t(display.key as never, display.values as never));

      if (display.kind === 'loading') {
        toast.loading(message, { id: TOAST_ID });
        return;
      }
      if (display.kind === 'sign-in') {
        toast(message, {
          id: TOAST_ID,
          action: {
            label: String(t('directorProject_signIn')),
            onClick: () => void window.screenforge.signInToDirector(),
          },
        });
        return;
      }
      if (display.kind === 'error') {
        toast.error(message, { id: TOAST_ID });
        return;
      }

      const { project } = display;
      const name = display.values.name;
      void (async () => {
        setSavedProjects(await window.screenforge.getProjects());
        trackEvent('director_project_opened', {
          source: event.status === 'opened' ? event.source : 'unknown',
        });
        if (isTitleRequired || !(await flushPendingSave())) {
          toast(t('directorProject_inLibrary', { name }), { id: TOAST_ID });
          return;
        }
        loadProjectSession(project);
        setLoadedProject(project);
        toast.success(message, { id: TOAST_ID });
      })();
    });
  }, [
    t,
    flushPendingSave,
    isTitleRequired,
    setLoadedProject,
    setSavedProjects,
    loadProjectSession,
  ]);
}
