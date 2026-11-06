import { DirectorApiError } from './client';
import { ProjectBundleError, toLibraryProject, type readProjectBundle } from './project-bundle';
import type {
  DirectorAccountState,
  DirectorProjectEvent,
  SavedProject,
} from '../../../src/types/index';

type Failure = Extract<DirectorProjectEvent, { status: 'failed' }>['reason'];

export interface ProjectOpenerDeps {
  account: {
    getState: () => DirectorAccountState;
    onChange: (listener: (state: DirectorAccountState) => void) => unknown;
    call: <T>(fn: () => Promise<T>) => Promise<T>;
  };
  /** Downloads a demo's bundle into `dir` (downloadProjectBundle). */
  download: (
    demoId: string,
    dir: string,
    onProgress: (progress: { filesDone: number; filesTotal: number }) => void,
  ) => Promise<{ projectFile: string; name: string }>;
  readBundle: typeof readProjectBundle;
  library: {
    getProjects: () => Promise<SavedProject[]>;
    saveProject: (project: SavedProject) => Promise<SavedProject>;
  };
  makeTempDir: () => Promise<string>;
  removeDir: (dir: string) => Promise<void>;
  newId: () => string;
  notify: (event: DirectorProjectEvent) => void;
}

/** The library id of a Director recording, so opening it twice finds the first copy. */
export const directorProjectId = (demoId: string) => `director-${demoId}`;

function failureOf(err: unknown): Failure | 'needs-sign-in' {
  if (err instanceof ProjectBundleError) {
    return err.reason;
  }
  if (err instanceof DirectorApiError) {
    if (err.status === 401) {
      return 'needs-sign-in';
    }
    if (err.code === 'PROJECT_NOT_AVAILABLE') {
      return 'not-available';
    }
    if (err.status === 404) {
      return 'not-found';
    }
  }
  return 'failed';
}

/**
 * Opens a Director recording as an editable project (#28): download its
 * bundle (project file, recording, narration), copy it into the library and
 * open it. Needs the optional Director sign-in; a link that arrives while
 * signed out waits for it. Bundles can also be opened from disk.
 */
export function createProjectOpener(deps: ProjectOpenerDeps) {
  let pendingDemoId: string | null = null;

  const fail = (err: unknown) => {
    const reason = failureOf(err);
    deps.notify(
      reason === 'needs-sign-in' ? { status: 'needs-sign-in' } : { status: 'failed', reason },
    );
  };

  const openDirectorDemo = async (demoId: string): Promise<void> => {
    if (deps.account.getState().status !== 'signed-in') {
      pendingDemoId = demoId;
      deps.notify({ status: 'needs-sign-in' });
      return;
    }
    pendingDemoId = null;

    const id = directorProjectId(demoId);
    const existing = (await deps.library.getProjects().catch(() => [])).find((p) => p.id === id);
    if (existing) {
      deps.notify({ status: 'opened', source: 'director', project: existing, existing: true });
      return;
    }

    deps.notify({ status: 'downloading', name: null, filesDone: 0, filesTotal: 0 });
    let dir: string | null = null;
    try {
      dir = await deps.makeTempDir();
      const tempDir = dir;
      const { projectFile, name } = await deps.account.call(() =>
        deps.download(demoId, tempDir, (progress) =>
          deps.notify({ status: 'downloading', name: null, ...progress }),
        ),
      );
      const bundle = await deps.readBundle(projectFile);
      const project = await deps.library.saveProject(
        toLibraryProject({ ...bundle, name: name || bundle.name }, id),
      );
      deps.notify({ status: 'opened', source: 'director', project });
    } catch (err) {
      fail(err);
    } finally {
      if (dir) {
        await deps.removeDir(dir).catch(() => undefined);
      }
    }
  };

  deps.account.onChange((state) => {
    if (state.status === 'signed-in' && pendingDemoId) {
      void openDirectorDemo(pendingDemoId);
    }
  });

  return {
    openDirectorDemo,

    /** A bundle from disk: its own new project, its files copied into the library. */
    async openBundleFile(projectFile: string): Promise<void> {
      try {
        const bundle = await deps.readBundle(projectFile);
        const project = await deps.library.saveProject(toLibraryProject(bundle, deps.newId()));
        deps.notify({ status: 'opened', source: 'file', project });
      } catch (err) {
        fail(err);
      }
    },
  };
}
