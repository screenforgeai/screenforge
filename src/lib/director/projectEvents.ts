import type { DirectorProjectEvent, SavedProject } from 'src/types';

export type ProjectEventDisplay =
  | { kind: 'loading'; key: string; values: Record<string, unknown> }
  | { kind: 'sign-in'; key: string; values: Record<string, unknown> }
  | { kind: 'error'; key: string; values: Record<string, unknown> }
  | { kind: 'open'; key: string; values: { name: string }; project: SavedProject };

/** What the app shows (and does) for each step of opening a Director project. */
export function describeProjectEvent(event: DirectorProjectEvent): ProjectEventDisplay {
  switch (event.status) {
    case 'downloading':
      return event.filesTotal > 0
        ? {
            kind: 'loading',
            key: 'directorProject_downloadingFiles',
            values: { done: event.filesDone, total: event.filesTotal },
          }
        : { kind: 'loading', key: 'directorProject_downloading', values: {} };
    case 'needs-sign-in':
      return { kind: 'sign-in', key: 'directorProject_needsSignIn', values: {} };
    case 'failed':
      return { kind: 'error', key: `directorProject_failed_${event.reason}`, values: {} };
    case 'opened':
      return {
        kind: 'open',
        key: 'directorProject_opened',
        values: { name: event.project.name },
        project: event.project,
      };
  }
}
