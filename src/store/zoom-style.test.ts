import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, useStore } from './index';
import {
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_CURSOR_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
  DEFAULT_ZOOM_STYLE,
} from './defaults';
import { defaultZoomClip } from '../lib/effects/zoom/analyze';
import { applyZoomStyle } from '../lib/effects/zoom/style';
import {
  createProjectSnapshotFromProject,
  createProjectSnapshotFromState,
} from '../lib/project-snapshot';
import type { SavedProject } from '../types';
import type { ZoomClip } from '../types/timeline';

const RECORDING_RESULT = {
  filePath: '/tmp/test-recording.mp4',
  mouseData: [],
  duration: 8,
  startTime: 0,
  recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

const project = (patch: Partial<SavedProject> = {}) =>
  ({
    id: 'project-zoom',
    name: 'Zoom style',
    result: RECORDING_RESULT,
    zoomClips: [],
    mediaSegments: [],
    frame: DEFAULT_FRAME,
    cursor: DEFAULT_CURSOR_SETTINGS,
    camera: DEFAULT_CAMERA_SETTINGS,
    keyboard: DEFAULT_KEYBOARD_SETTINGS,
    savedAt: new Date(0).toISOString(),
    thumbnail: '',
    ...patch,
  }) as unknown as SavedProject;

const legacyAutoClip = () => {
  // Saved before zoom style existed: no `easing` and no `autoScale`.
  const clip: Partial<ZoomClip> = defaultZoomClip('zoom-auto-0', 0, 3, 0.5, 0.5, 2.2);
  delete clip.easing;
  return clip;
};

beforeEach(() => {
  act(() => {
    useStore.getState().resetEditorSession();
  });
});

describe('zoom style in the editor session', () => {
  it('starts new recordings with the default zoom style', () => {
    act(() => {
      useStore.getState().loadRecordingSession(RECORDING_RESULT as never);
    });

    expect(useStore.getState().zoomStyle).toEqual(DEFAULT_ZOOM_STYLE);
  });

  it('opens a project saved before zoom style existed unchanged', () => {
    act(() => {
      useStore
        .getState()
        .loadProjectSession(
          project({ zoomClips: [legacyAutoClip()] as SavedProject['zoomClips'] }),
        );
    });

    const { zoomStyle, zoomClips } = useStore.getState();
    expect(zoomStyle).toEqual(DEFAULT_ZOOM_STYLE);
    expect(zoomClips[0]).toMatchObject({ scale: 2.2, easing: 'standard', autoScale: 2.2 });
  });

  it('opens a project with its saved zoom style', () => {
    act(() => {
      useStore.getState().loadProjectSession(
        project({
          zoomStyle: { intensity: 0.75, easing: 'gentle' },
          zoomClips: [{ ...defaultZoomClip('zoom-auto-0', 0, 3, 0.5, 0.5, 1.9), autoScale: 2.2 }],
        }),
      );
    });

    const { zoomStyle, zoomClips } = useStore.getState();
    expect(zoomStyle).toEqual({ intensity: 0.75, easing: 'gentle' });
    expect(zoomClips[0].autoScale).toBe(2.2);
    expect(zoomClips[0].scale).toBe(1.9);
  });

  it('undoes a whole intensity slider drag in one step', () => {
    act(() => {
      useStore.getState().loadProjectSession(
        project({
          zoomClips: [{ ...defaultZoomClip('zoom-auto-0', 0, 3, 0.5, 0.5, 2), autoScale: 2 }],
        }),
      );
    });

    act(() => {
      const store = useStore.getState();
      store.beginHistoryGroup('zoom-intensity', 'Adjust zoom intensity');
      for (const intensity of [0.9, 0.8, 0.7]) {
        store.commitEdit('Adjust zoom intensity', (state) => applyZoomStyle(state, { intensity }));
      }
      store.endHistoryGroup('zoom-intensity');
    });

    expect(useStore.getState().zoomStyle.intensity).toBe(0.7);
    expect(useStore.getState().zoomClips[0].scale).toBe(1.7);

    act(() => {
      useStore.getState().undo();
    });

    expect(useStore.getState().zoomStyle).toEqual(DEFAULT_ZOOM_STYLE);
    expect(useStore.getState().zoomClips[0].scale).toBe(2);

    act(() => {
      useStore.getState().redo();
    });

    expect(useStore.getState().zoomStyle.intensity).toBe(0.7);
    expect(useStore.getState().zoomClips[0].scale).toBe(1.7);
  });

  it('undoes an easing preset change', () => {
    act(() => {
      useStore.getState().loadRecordingSession(RECORDING_RESULT as never);
      useStore
        .getState()
        .commitEdit('Change zoom easing', (state) => applyZoomStyle(state, { easing: 'snappy' }));
    });

    expect(useStore.getState().zoomStyle.easing).toBe('snappy');

    act(() => {
      useStore.getState().undo();
    });

    expect(useStore.getState().zoomStyle.easing).toBe('standard');
  });
});

describe('zoom style in project snapshots', () => {
  it('saves the zoom style with the project', () => {
    act(() => {
      useStore.getState().loadRecordingSession(RECORDING_RESULT as never);
      useStore
        .getState()
        .commitEdit('Change zoom easing', (state) =>
          applyZoomStyle(state, { easing: 'gentle', intensity: 1.2 }),
        );
    });

    const snapshot = createProjectSnapshotFromState(useStore.getState());
    expect(snapshot?.zoomStyle).toEqual({ intensity: 1.2, easing: 'gentle' });
  });

  it('reads the default zoom style from a project saved without one', () => {
    expect(createProjectSnapshotFromProject(project()).zoomStyle).toEqual(DEFAULT_ZOOM_STYLE);
  });
});
