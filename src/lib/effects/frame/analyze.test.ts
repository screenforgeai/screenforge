import { describe, expect, it } from 'vitest';
import type { StoredProjectLike } from '../../../types';
import { DEFAULT_KEYBOARD_SETTINGS } from '../../../store/defaults';
import { cloneFrameSettings, DEFAULT_FRAME, normalizeSavedProject } from './analyze';

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

  const projectWithFrame = (frame: unknown) =>
    ({
      id: 'project-2',
      name: 'Branded',
      result: {
        filePath: 'fixture.mp4',
        mouseData: [],
        duration: 3,
        startTime: 1_000,
        recordingArea: { x: 0, y: 0, width: 1280, height: 720 },
      },
      zoomClips: [],
      frame,
      savedAt: '2026-01-01T00:00:00.000Z',
      thumbnail: '',
    }) as StoredProjectLike;

  it('loads a project without a logo unchanged, with no logo key', () => {
    const project = normalizeSavedProject(projectWithFrame(DEFAULT_FRAME));
    expect(project.frame).toEqual(DEFAULT_FRAME);
    expect('logo' in project.frame).toBe(false);
  });

  it('keeps a saved logo and drops a broken one', () => {
    const logo = { src: 'data:image/png;base64,AA==', corner: 'top-left', size: 0.2, opacity: 80 };
    expect(normalizeSavedProject(projectWithFrame({ ...DEFAULT_FRAME, logo })).frame.logo).toEqual(
      logo,
    );
    expect(
      'logo' in
        normalizeSavedProject(projectWithFrame({ ...DEFAULT_FRAME, logo: { size: 1 } })).frame,
    ).toBe(false);
  });
});

describe('cloneFrameSettings', () => {
  it('copies the logo along with the rest of the frame', () => {
    const logo = {
      src: 'data:image/png;base64,AA==',
      corner: 'top-left' as const,
      size: 0.2,
      opacity: 80,
    };
    const frame = { ...DEFAULT_FRAME, logo };
    const clone = cloneFrameSettings(frame);
    expect(clone).toEqual(frame);
    expect(clone.logo).not.toBe(logo);
  });

  it('adds no logo key to a frame without one', () => {
    expect('logo' in cloneFrameSettings(DEFAULT_FRAME)).toBe(false);
  });
});
