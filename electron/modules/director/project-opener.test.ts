import { describe, expect, it, vi } from 'vitest';
import { DirectorApiError } from './client';
import { ProjectBundleError } from './project-bundle';
import { createProjectOpener } from './project-opener';
import type { DirectorAccountState, SavedProject } from '../../../src/types/index';

const SIGNED_IN: DirectorAccountState = {
  status: 'signed-in',
  user: { id: 'u', email: 'a@b.co' },
  workspace: { id: 'w', name: 'W' },
  remembered: true,
};
const DEMO = '6f1c2a3b-1111-4222-8333-944455556666';
const BUNDLE_PROJECT = { name: 'Invite', result: { filePath: '/tmp/x/recording.mp4' } };

const setup = (state: DirectorAccountState = SIGNED_IN) => {
  let accountState = state;
  const accountListeners: ((s: DirectorAccountState) => void)[] = [];
  const events: unknown[] = [];
  const deps = {
    account: {
      getState: () => accountState,
      onChange: (l: (s: DirectorAccountState) => void) => {
        accountListeners.push(l);
        return (): void => undefined;
      },
      call: <T>(fn: () => Promise<T>): Promise<T> => fn(),
    },
    download: vi.fn().mockResolvedValue({ projectFile: '/tmp/x/project.json', name: 'Invite' }),
    readBundle: vi.fn().mockResolvedValue(BUNDLE_PROJECT),
    library: {
      getProjects: vi.fn().mockResolvedValue([] as SavedProject[]),
      saveProject: vi.fn(async (p: SavedProject) => ({ ...p, saved: true }) as SavedProject),
    },
    makeTempDir: vi.fn().mockResolvedValue('/tmp/x'),
    removeDir: vi.fn().mockResolvedValue(undefined),
    newId: () => 'new-id',
    notify: (e: unknown) => events.push(e),
  };
  const opener = createProjectOpener(deps);
  const signIn = (next: DirectorAccountState) => {
    accountState = next;
    accountListeners.forEach((l) => l(next));
  };
  return { opener, deps, events, signIn };
};

describe('opening a Director recording', () => {
  it('downloads the bundle, adds it to the library under the demo, and opens it', async () => {
    const { opener, deps, events } = setup();
    await opener.openDirectorDemo(DEMO);

    expect(deps.download).toHaveBeenCalledWith(DEMO, '/tmp/x', expect.any(Function));
    expect(deps.readBundle).toHaveBeenCalledWith('/tmp/x/project.json');
    expect(deps.library.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: `director-${DEMO}`, name: 'Invite' }),
    );
    expect(events[0]).toEqual({ status: 'downloading', name: null, filesDone: 0, filesTotal: 0 });
    expect(events.at(-1)).toMatchObject({
      status: 'opened',
      source: 'director',
      project: { id: `director-${DEMO}`, saved: true },
    });
    expect(deps.removeDir).toHaveBeenCalledWith('/tmp/x');
  });

  it('opens the copy already in the library instead of downloading it again', async () => {
    const { opener, deps, events } = setup();
    const existing = { id: `director-${DEMO}`, name: 'Edited' } as SavedProject;
    deps.library.getProjects.mockResolvedValue([existing]);
    await opener.openDirectorDemo(DEMO);
    expect(deps.download).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      status: 'opened',
      source: 'director',
      project: existing,
      existing: true,
    });
  });

  it('asks to sign in first, then carries on once signed in', async () => {
    const { opener, deps, events, signIn } = setup({ status: 'signed-out' });
    await opener.openDirectorDemo(DEMO);
    expect(events).toEqual([{ status: 'needs-sign-in' }]);
    expect(deps.download).not.toHaveBeenCalled();

    signIn(SIGNED_IN);
    await vi.waitFor(() => expect(deps.download).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ status: 'opened' }));
  });

  it.each([
    [new DirectorApiError(409, 'PROJECT_NOT_AVAILABLE', 'x'), 'not-available'],
    [new DirectorApiError(404, 'NOT_FOUND', 'x'), 'not-found'],
    [new DirectorApiError(401, 'UNAUTHORIZED', 'x'), 'needs-sign-in'],
    [new DirectorApiError(0, 'NETWORK_ERROR', 'x'), 'failed'],
    [new ProjectBundleError('invalid', 'x'), 'invalid'],
    [new Error('disk full'), 'failed'],
  ])('reports %s as %s, and cleans up', async (error, reason) => {
    const { opener, deps, events } = setup();
    deps.download.mockRejectedValue(error);
    await opener.openDirectorDemo(DEMO);
    expect(events.at(-1)).toEqual(
      reason === 'needs-sign-in' ? { status: 'needs-sign-in' } : { status: 'failed', reason },
    );
    expect(deps.removeDir).toHaveBeenCalledWith('/tmp/x');
  });

  it('opens a bundle from disk as a new project', async () => {
    const { opener, deps, events } = setup({ status: 'signed-out' });
    await opener.openBundleFile('/Users/m/Downloads/demo/project.json');
    expect(deps.readBundle).toHaveBeenCalledWith('/Users/m/Downloads/demo/project.json');
    expect(deps.library.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-id' }),
    );
    expect(events.at(-1)).toMatchObject({ status: 'opened', source: 'file' });
    expect(deps.removeDir).not.toHaveBeenCalled();
  });

  it("explains a file that isn't a project", async () => {
    const { opener, deps, events } = setup();
    deps.readBundle.mockRejectedValue(new ProjectBundleError('missing-recording', 'x'));
    await opener.openBundleFile('/x/project.json');
    expect(events.at(-1)).toEqual({ status: 'failed', reason: 'missing-recording' });
  });
});
