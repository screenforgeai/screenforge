import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportPrerenderStatus } from '../types';
import { useStore } from '../store';
import { setPreviewDrawing } from '../lib/pixi/previewActivity';

const prepareExportCapture = vi.hoisted(() => vi.fn());
vi.mock('../lib/export/captureParams', () => ({ prepareExportCapture }));

import {
  PRERENDER_ACTIVE_DUTY_CYCLE,
  PRERENDER_EDIT_DELAY_MS,
  PRERENDER_IDLE_DUTY_CYCLE,
  PRERENDER_IDLE_SETTLE_MS,
  PRERENDER_PLAYBACK_DELAY_MS,
  prerenderSettingsKey,
  selectPrerenderReadiness,
  useExportPrerender,
  usePrerenderStore,
} from './useExportPrerender';

const startExportPrerender = vi.fn();
const stopExportPrerender = vi.fn();
const setExportPrerenderPace = vi.fn();
const canPrerenderOnPower = vi.fn();
let powerListener: ((allowed: boolean) => void) | null = null;
let statusListener: ((status: ExportPrerenderStatus) => void) | null = null;

const initialStore = useStore.getState();

let hidden = false;

beforeEach(() => {
  vi.useFakeTimers();
  // The hook times stillness with performance.now(), which these fake timers leave alone.
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
  hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  statusListener = null;
  startExportPrerender.mockResolvedValue(true);
  stopExportPrerender.mockResolvedValue(undefined);
  canPrerenderOnPower.mockResolvedValue(true);
  powerListener = null;
  prepareExportCapture.mockResolvedValue({
    params: { format: 'mp4', fps: 60 },
    effectiveFps: 60,
    duration: 10,
    warnings: [],
  });
  Object.defineProperty(window, 'screenforge', {
    value: {
      startExportPrerender,
      stopExportPrerender,
      setExportPrerenderPace,
      canPrerenderOnPower,
      onPrerenderPowerChanged: vi.fn((cb: (allowed: boolean) => void) => {
        powerListener = cb;
        return () => {
          powerListener = null;
        };
      }),
      onPrerenderStatus: vi.fn((cb: (status: ExportPrerenderStatus) => void) => {
        statusListener = cb;
        return () => {
          statusListener = null;
        };
      }),
    },
    writable: true,
    configurable: true,
  });
  useStore.setState({
    ...initialStore,
    recordingResult: { filePath: '/r.mp4', duration: 10 } as never,
    isExporting: false,
  });
  usePrerenderStore.setState({ stateVersion: 0, settingsKey: null, status: null, blocked: false });
  setPreviewDrawing(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  useStore.setState(initialStore, true);
});

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Starts the hook and lets the first pre-render begin. Pre-renders keep
 * running until stopped, and a stop resolves the running one a little later,
 * as the main process does once its hidden window is gone.
 */
async function startRunning() {
  let finishRunning: ((completed: boolean) => void) | null = null;
  startExportPrerender.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finishRunning = resolve;
      }),
  );
  stopExportPrerender.mockImplementation(async () => {
    const finish = finishRunning;
    finishRunning = null;
    setTimeout(() => finish?.(false), 1_500);
  });
  renderHook(() => useExportPrerender(true));
  await wait(PRERENDER_EDIT_DELAY_MS);
  expect(startExportPrerender).toHaveBeenCalledTimes(1);
}

describe('useExportPrerender', () => {
  it('starts shortly after a project is open, without audio', async () => {
    renderHook(() => useExportPrerender(true));
    await wait(PRERENDER_EDIT_DELAY_MS - 1);
    expect(startExportPrerender).not.toHaveBeenCalled();
    await wait(1);
    expect(startExportPrerender).toHaveBeenCalledTimes(1);
    expect(startExportPrerender.mock.calls[0][0]).toMatchObject({
      chunking: 'prerender',
      includeAudio: false,
      stateVersion: 0,
    });
  });

  it('starts held while the preview draws, flat out once the editor is still', async () => {
    setPreviewDrawing(true);
    const { unmount } = renderHook(() => useExportPrerender(true));
    await wait(PRERENDER_EDIT_DELAY_MS);
    expect(startExportPrerender.mock.calls[0][0].dutyCycle).toBe(PRERENDER_ACTIVE_DUTY_CYCLE);
    unmount();

    setPreviewDrawing(false);
    renderHook(() => useExportPrerender(true));
    await wait(PRERENDER_EDIT_DELAY_MS);
    expect(startExportPrerender.mock.calls[1][0].dutyCycle).toBe(PRERENDER_IDLE_DUTY_CYCLE);
  });

  it('holds as soon as the preview wakes, and goes on once it has slept a moment', async () => {
    await startRunning();
    expect(setExportPrerenderPace).toHaveBeenLastCalledWith(PRERENDER_IDLE_DUTY_CYCLE);
    setExportPrerenderPace.mockClear();

    act(() => setPreviewDrawing(true));
    expect(setExportPrerenderPace).toHaveBeenLastCalledWith(PRERENDER_ACTIVE_DUTY_CYCLE);

    // Brief sleeps between wake-ups (edits a moment apart) keep it held.
    act(() => setPreviewDrawing(false));
    await wait(PRERENDER_IDLE_SETTLE_MS - 1);
    act(() => setPreviewDrawing(true));
    act(() => setPreviewDrawing(false));
    await wait(PRERENDER_IDLE_SETTLE_MS - 1);
    expect(setExportPrerenderPace).toHaveBeenCalledTimes(1);

    await wait(1);
    expect(setExportPrerenderPace).toHaveBeenLastCalledWith(PRERENDER_IDLE_DUTY_CYCLE);
    expect(setExportPrerenderPace).toHaveBeenCalledTimes(2);
    // Pace changes are not restarts.
    expect(startExportPrerender).toHaveBeenCalledTimes(1);
    expect(stopExportPrerender).not.toHaveBeenCalled();
  });

  it.each([
    ['a click', () => new PointerEvent('pointerdown')],
    ['a key', () => new KeyboardEvent('keydown', { key: 'z' })],
    ['a scroll', () => new WheelEvent('wheel')],
  ])('holds on %s before the editor handles it, then goes on once still', async (_, make) => {
    await startRunning();
    setExportPrerenderPace.mockClear();

    // Not bubbling, as if an editor handler had stopped it: only a capture-phase
    // listener, which runs before the editor's, sees it.
    act(() => {
      document.body.dispatchEvent(make());
    });
    expect(setExportPrerenderPace).toHaveBeenLastCalledWith(PRERENDER_ACTIVE_DUTY_CYCLE);

    await wait(PRERENDER_IDLE_SETTLE_MS - 1);
    expect(setExportPrerenderPace).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(setExportPrerenderPace).toHaveBeenLastCalledWith(PRERENDER_IDLE_DUTY_CYCLE);
  });

  it('goes flat out while the window is hidden, whatever the preview last said', async () => {
    await startRunning();
    act(() => setPreviewDrawing(true));
    expect(setExportPrerenderPace).toHaveBeenLastCalledWith(PRERENDER_ACTIVE_DUTY_CYCLE);

    hidden = true;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(setExportPrerenderPace).toHaveBeenLastCalledWith(PRERENDER_IDLE_DUTY_CYCLE);

    hidden = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(setExportPrerenderPace).toHaveBeenLastCalledWith(PRERENDER_ACTIVE_DUTY_CYCLE);
  });

  it('restarts after an edit settles, with the new state version', async () => {
    await startRunning();
    act(() => useStore.setState({ zoomClips: [] }));
    expect(stopExportPrerender).toHaveBeenCalled();
    expect(usePrerenderStore.getState().stateVersion).toBe(1);
    // A second edit within the delay pushes the restart back.
    await wait(PRERENDER_EDIT_DELAY_MS - 100);
    act(() => useStore.setState({ zoomClips: [] }));
    await wait(PRERENDER_EDIT_DELAY_MS - 1);
    expect(startExportPrerender).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(startExportPrerender).toHaveBeenCalledTimes(2);
    expect(startExportPrerender.mock.calls[1][0].stateVersion).toBe(2);
  });

  it('drops a start whose project changed while it checked the power', async () => {
    let answerPower: (allowed: boolean) => void = () => undefined;
    canPrerenderOnPower.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (answerPower = resolve)),
    );
    renderHook(() => useExportPrerender(true));
    await wait(PRERENDER_EDIT_DELAY_MS);
    // Captions turned off (any edit) while the power check is out.
    act(() => useStore.setState({ zoomClips: [] }));
    await act(async () => answerPower(true));
    expect(startExportPrerender).not.toHaveBeenCalled();

    // The restart after the edit renders the new state instead.
    await wait(PRERENDER_EDIT_DELAY_MS);
    expect(startExportPrerender).toHaveBeenCalledTimes(1);
    expect(startExportPrerender.mock.calls[0][0].stateVersion).toBe(1);
  });

  it('pauses for playback and resumes once the playhead is still', async () => {
    await startRunning();
    act(() => useStore.setState({ currentTime: 1 }));
    expect(stopExportPrerender).toHaveBeenCalledTimes(1);
    await wait(500);
    act(() => useStore.setState({ currentTime: 1.5 }));
    await wait(PRERENDER_PLAYBACK_DELAY_MS - 1);
    expect(startExportPrerender).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(startExportPrerender).toHaveBeenCalledTimes(2);
    // Playback is not an edit.
    expect(usePrerenderStore.getState().stateVersion).toBe(0);
  });

  it('keeps running through changes that do not affect the export', async () => {
    await startRunning();
    act(() =>
      useStore.setState({
        activeWidget: initialStore.activeWidget === 'frame' ? 'cursor' : 'frame',
      } as never),
    );
    expect(stopExportPrerender).not.toHaveBeenCalled();
    await wait(PRERENDER_EDIT_DELAY_MS * 3);
    expect(startExportPrerender).toHaveBeenCalledTimes(1);
  });

  it('stops for an export and resumes after it', async () => {
    await startRunning();
    act(() => useStore.setState({ isExporting: true }));
    expect(stopExportPrerender).toHaveBeenCalled();
    await wait(PRERENDER_EDIT_DELAY_MS * 3);
    expect(startExportPrerender).toHaveBeenCalledTimes(1);
    act(() => useStore.setState({ isExporting: false }));
    await wait(PRERENDER_EDIT_DELAY_MS);
    expect(startExportPrerender).toHaveBeenCalledTimes(2);
  });

  it('does not run on low battery, during an export, or with nothing loaded', async () => {
    canPrerenderOnPower.mockResolvedValue(false);
    const { unmount } = renderHook(() => useExportPrerender(true));
    await wait(PRERENDER_EDIT_DELAY_MS);
    expect(startExportPrerender).not.toHaveBeenCalled();
    expect(usePrerenderStore.getState().blocked).toBe(true);
    unmount();

    canPrerenderOnPower.mockResolvedValue(true);
    powerListener = null;
    useStore.setState({ isExporting: true });
    const second = renderHook(() => useExportPrerender(true));
    await wait(PRERENDER_EDIT_DELAY_MS);
    expect(startExportPrerender).not.toHaveBeenCalled();
    second.unmount();

    useStore.setState({ isExporting: false, recordingResult: null });
    renderHook(() => useExportPrerender(true));
    await wait(PRERENDER_EDIT_DELAY_MS);
    expect(startExportPrerender).not.toHaveBeenCalled();
  });

  it('starts once power allows it again (plugged in, or battery back above 30%)', async () => {
    canPrerenderOnPower.mockResolvedValue(false);
    renderHook(() => useExportPrerender(true));
    await wait(PRERENDER_EDIT_DELAY_MS);
    expect(startExportPrerender).not.toHaveBeenCalled();
    expect(usePrerenderStore.getState().blocked).toBe(true);

    canPrerenderOnPower.mockResolvedValue(true);
    act(() => powerListener?.(true));
    expect(usePrerenderStore.getState().blocked).toBe(false);
    await wait(PRERENDER_EDIT_DELAY_MS);
    expect(startExportPrerender).toHaveBeenCalledTimes(1);
  });

  it('marks itself blocked when power stops allowing it', async () => {
    await startRunning();
    act(() => powerListener?.(false));
    expect(usePrerenderStore.getState().blocked).toBe(true);
  });

  it('does nothing when disabled', async () => {
    renderHook(() => useExportPrerender(false));
    await wait(PRERENDER_EDIT_DELAY_MS * 3);
    expect(startExportPrerender).not.toHaveBeenCalled();
  });

  it('keeps the latest status for the export dialog', async () => {
    renderHook(() => useExportPrerender(true));
    act(() => statusListener?.({ phase: 'planned', total: 10, cached: 4, stateVersion: 0 }));
    expect(usePrerenderStore.getState().status?.cached).toBe(4);
  });
});

describe('selectPrerenderReadiness', () => {
  const key = prerenderSettingsKey({
    format: 'mp4',
    resolution: '1080p',
    fps: 60,
    quality: 'high',
  });
  const status: ExportPrerenderStatus = { phase: 'planned', total: 10, cached: 7, stateVersion: 3 };

  it('reports readiness for the same project state and settings', () => {
    expect(selectPrerenderReadiness({ stateVersion: 3, settingsKey: key, status }, key)).toEqual({
      total: 10,
      cached: 7,
    });
  });

  it('is unknown after an edit or for other settings', () => {
    expect(selectPrerenderReadiness({ stateVersion: 4, settingsKey: key, status }, key)).toBeNull();
    expect(
      selectPrerenderReadiness({ stateVersion: 3, settingsKey: key, status }, `${key}x`),
    ).toBeNull();
    expect(
      selectPrerenderReadiness({ stateVersion: 3, settingsKey: key, status: null }, key),
    ).toBeNull();
  });
});
