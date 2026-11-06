import { describe, expect, it } from 'vitest';
import type { SavedProject } from 'src/types';
import { describeProjectEvent } from './projectEvents';

describe('describeProjectEvent', () => {
  it('shows download progress once files are known', () => {
    expect(
      describeProjectEvent({ status: 'downloading', name: null, filesDone: 0, filesTotal: 0 }),
    ).toEqual({ kind: 'loading', key: 'directorProject_downloading', values: {} });
    expect(
      describeProjectEvent({ status: 'downloading', name: null, filesDone: 1, filesTotal: 3 }),
    ).toEqual({
      kind: 'loading',
      key: 'directorProject_downloadingFiles',
      values: { done: 1, total: 3 },
    });
  });

  it('offers to sign in when Director needs it', () => {
    expect(describeProjectEvent({ status: 'needs-sign-in' })).toEqual({
      kind: 'sign-in',
      key: 'directorProject_needsSignIn',
      values: {},
    });
  });

  it.each(['not-available', 'not-found', 'invalid', 'missing-recording', 'failed'] as const)(
    'explains a %s failure',
    (reason) => {
      expect(describeProjectEvent({ status: 'failed', reason })).toEqual({
        kind: 'error',
        key: `directorProject_failed_${reason}`,
        values: {},
      });
    },
  );

  it('opens the project, naming it', () => {
    const project = { id: 'p', name: 'Invite a teammate' } as SavedProject;
    expect(describeProjectEvent({ status: 'opened', source: 'director', project })).toEqual({
      kind: 'open',
      key: 'directorProject_opened',
      values: { name: 'Invite a teammate' },
      project,
    });
  });
});
