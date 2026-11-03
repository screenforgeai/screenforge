import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, useStore } from './index';
import {
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_CURSOR_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
} from './defaults';
import type { SavedProject } from '../types';

const CROPPED_RECT = { x: 0.18, y: 0.12, width: 0.58, height: 0.64 };
const RECORDING_RESULT = {
  filePath: '/tmp/test-recording.mp4',
  mouseData: [],
  duration: 8,
  startTime: 0,
  recordingArea: {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  },
};

beforeEach(() => {
  act(() => {
    useStore.getState().resetEditorSession();
    useStore.getState().clearPendingPauseSeek();
    useStore.getState().setIsCropEditing(false);
    useStore.getState().setActiveWidget('recordings');
    useStore.getState().setFrame(DEFAULT_FRAME);
  });
});

describe('useStore.setActiveWidget', () => {
  it('closes crop editing when switching away from the frame widget', () => {
    for (const tab of ['recordings', 'zoom', 'camera', 'cursor', 'keyboard'] as const) {
      act(() => {
        useStore.getState().setActiveWidget('frame');
        useStore.getState().setIsCropEditing(true);
        useStore.getState().setActiveWidget(tab);
      });

      expect(useStore.getState().activeWidget).toBe(tab);
      expect(useStore.getState().isCropEditing).toBe(false);
    }
  });

  it('preserves the applied crop rect when switching away from the frame widget', () => {
    act(() => {
      useStore.getState().setActiveWidget('frame');
      useStore.getState().setFrame({
        ...useStore.getState().frame,
        cropRect: CROPPED_RECT,
      });
      useStore.getState().setIsCropEditing(true);
      useStore.getState().setActiveWidget('camera');
    });

    expect(useStore.getState().isCropEditing).toBe(false);
    expect(useStore.getState().frame.cropRect).toEqual(CROPPED_RECT);
  });

  it('tracks keyboard edits in undo history', () => {
    expect(useStore.getState().keyboard).toEqual(DEFAULT_KEYBOARD_SETTINGS);

    act(() => {
      useStore.getState().commitEdit('Hide keyboard captions', (state) => ({
        keyboard: { ...state.keyboard, enabled: false },
      }));
    });

    expect(useStore.getState().keyboard.enabled).toBe(false);

    act(() => {
      useStore.getState().undo();
    });

    expect(useStore.getState().keyboard.enabled).toBe(true);

    act(() => {
      useStore.getState().redo();
    });

    expect(useStore.getState().keyboard.enabled).toBe(false);
  });

  it('normalizes legacy zoom clips when loading a saved project', () => {
    act(() => {
      useStore.getState().loadProjectSession({
        id: 'project-1',
        name: 'Legacy project',
        result: RECORDING_RESULT,
        zoomClips: [
          {
            id: 'legacy-zoom',
            start: 0,
            end: 2,
            scale: 2,
            cx: 0.4,
            cy: 0.6,
            easeIn: 0.6,
            easeOut: 0.8,
            mode: 'auto',
          },
        ],
        mediaSegments: [],
        frame: DEFAULT_FRAME,
        cursor: DEFAULT_CURSOR_SETTINGS,
        camera: DEFAULT_CAMERA_SETTINGS,
        keyboard: DEFAULT_KEYBOARD_SETTINGS,
        savedAt: new Date(0).toISOString(),
        thumbnail: '',
      } as unknown as SavedProject);
    });

    expect(useStore.getState().zoomClips[0].preset).toBe('standard');
    expect(useStore.getState().zoomClips[0].cinematicIntensity).toBe(0.65);
    expect(useStore.getState().zoomClips[0].cinematicDepth).toBe(0.65);
    expect(useStore.getState().zoomClips[0].cinematicFocus).toBe(0.75);
    expect(useStore.getState().zoomClips[0].cinematicBackgroundFade).toBe(0.75);
    expect(useStore.getState().zoomClips[0].cinematicTilt).toBe(0.65);
    expect(useStore.getState().zoomClips[0].cinematicMotionBlur).toBe(0.2);
    expect(useStore.getState().zoomClips[0].cinematicTiltMode).toBe('follow');
  });
});
