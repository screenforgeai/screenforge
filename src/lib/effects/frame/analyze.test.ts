import { describe, expect, it } from 'vitest';
import type { StoredProjectLike } from '../../../types';
import { DEFAULT_KEYBOARD_SETTINGS } from '../../../store/defaults';
import { normalizeSavedProject } from './analyze';

describe('normalizeSavedProject', () => {
  it('adds default keyboard settings for older projects', () => {
    const project = normalizeSavedProject({
      id: 'project-1',
      name: 'Old project',
      result: {
        filePath: 'fixture.mp4',
        mouseData: [],
        duration: 3,
        startTime: 1_000,
        recordingArea: { x: 0, y: 0, width: 1280, height: 720 },
      },
      zoomClips: [],
      savedAt: '2026-01-01T00:00:00.000Z',
      thumbnail: '',
    } as StoredProjectLike);

    expect(project.keyboard).toEqual(DEFAULT_KEYBOARD_SETTINGS);
  });
});
