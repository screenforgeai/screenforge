import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingResult } from '../types';
import { useStore } from '../store';

const persistence = vi.hoisted(() => ({
  beginNewRecording: vi.fn(),
  flushPendingSave: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('../components/ProjectPersistenceProvider', () => ({
  useProjectPersistence: () => persistence,
}));

vi.mock('sonner', () => ({ toast: toastMock }));

import { useSampleProject } from './useSampleProject';

const sampleResult: RecordingResult = {
  filePath: '/userData/imports/sample-1.mp4',
  mouseData: [{ type: 'mousedown', x: 100, y: 100, button: 1, timestamp: 2_000 }],
  duration: 12,
  startTime: 1_000,
  recordingArea: { x: 0, y: 0, width: 1280, height: 800 },
  hasEmbeddedAudio: false,
};

const initialState = useStore.getState();

function installScreenforge(importSampleProject = vi.fn().mockResolvedValue(sampleResult)) {
  const api = { importSampleProject, trackEvent: vi.fn() };
  Object.defineProperty(window, 'screenforge', {
    value: api,
    writable: true,
    configurable: true,
  });
  return api;
}

describe('useSampleProject', () => {
  beforeEach(() => {
    useStore.setState(initialState, true);
    persistence.flushPendingSave.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('loads the sample as a new, named project and shows off auto-zoom', async () => {
    const api = installScreenforge();
    const { result } = renderHook(() => useSampleProject());

    await act(async () => {
      await result.current.openSampleProject('empty_state');
    });

    const state = useStore.getState();
    expect(state.recordingResult?.filePath).toBe(sampleResult.filePath);
    expect(state.recordingName).toBe('Sample project');
    expect(state.activeWidget).toBe('zoom');
    // The user confirms the title before it lands in their library, like any new recording.
    expect(persistence.beginNewRecording).toHaveBeenCalledOnce();
    expect(api.trackEvent).toHaveBeenCalledWith('sample_project_opened', {
      source: 'empty_state',
    });
  });

  it('saves the open project first, and stays put if that fails', async () => {
    const api = installScreenforge();
    useStore.setState({ recordingResult: { ...sampleResult, filePath: '/mine.mp4' } });
    persistence.flushPendingSave.mockResolvedValue(false);
    const { result } = renderHook(() => useSampleProject());

    await act(async () => {
      await result.current.openSampleProject('permissions_guide');
    });

    expect(persistence.flushPendingSave).toHaveBeenCalledOnce();
    expect(api.importSampleProject).not.toHaveBeenCalled();
    expect(useStore.getState().recordingResult?.filePath).toBe('/mine.mp4');
  });

  it('imports the sample once when it is asked for twice in the same render', async () => {
    const pendingImports: Array<(value: RecordingResult) => void> = [];
    const api = installScreenforge(
      vi.fn(
        () =>
          new Promise<RecordingResult>((resolve) => {
            pendingImports.push(resolve);
          }),
      ),
    );
    const { result } = renderHook(() => useSampleProject());
    const { openSampleProject } = result.current;

    await act(async () => {
      const first = openSampleProject('empty_state');
      const second = openSampleProject('empty_state');
      await Promise.resolve();
      pendingImports.forEach((resolve) => resolve(sampleResult));
      await Promise.all([first, second]);
    });

    expect(api.importSampleProject).toHaveBeenCalledOnce();
    expect(persistence.beginNewRecording).toHaveBeenCalledOnce();
  });

  it('imports once when the guide and the empty canvas both ask for the sample', async () => {
    const pendingImports: Array<(value: RecordingResult) => void> = [];
    const api = installScreenforge(
      vi.fn(
        () =>
          new Promise<RecordingResult>((resolve) => {
            pendingImports.push(resolve);
          }),
      ),
    );
    const guide = renderHook(() => useSampleProject());
    const canvas = renderHook(() => useSampleProject());

    await act(async () => {
      const first = guide.result.current.openSampleProject('permissions_guide');
      const second = canvas.result.current.openSampleProject('empty_state');
      await Promise.resolve();
      pendingImports.forEach((resolve) => resolve(sampleResult));
      await Promise.all([first, second]);
    });

    expect(api.importSampleProject).toHaveBeenCalledOnce();
    expect(persistence.beginNewRecording).toHaveBeenCalledOnce();
  });

  it('tells the user when the sample cannot be opened', async () => {
    installScreenforge(vi.fn().mockRejectedValue(new Error('missing resource')));
    const { result } = renderHook(() => useSampleProject());

    await act(async () => {
      await result.current.openSampleProject('empty_state');
    });

    expect(toastMock.error).toHaveBeenCalledWith("Couldn't open the sample project.");
    expect(useStore.getState().recordingResult).toBeNull();
    expect(persistence.beginNewRecording).not.toHaveBeenCalled();
  });
});
