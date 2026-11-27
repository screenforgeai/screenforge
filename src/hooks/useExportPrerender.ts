/**
 * Background pre-rendering: while someone edits, render the export's chunks
 * into the cache with the last-used export settings, so that by the time they
 * click Export it only has to join them. People spend a median 3.3 minutes in
 * the editor before exporting — about 5.7× the video's length — so there is
 * usually time to finish.
 *
 * - An edit restarts it shortly after the last change; chunks the edit did not
 *   touch stay cached and are skipped.
 * - Playback and scrubbing (the playhead moving) pause it, so the preview gets
 *   the GPU; it resumes once the playhead has been still for a moment.
 * - An export stops it; other UI changes (selection, panels) leave it alone.
 * - It runs at low priority, flat out while the editor is still (its preview
 *   asleep) and held while someone uses it: the preview drawing, or a click,
 *   key or scroll in the last moment. It runs on mains power, or on
 *   battery while at least 30% is left, and never while recording (both
 *   checked in the main process, which also stops it when that changes).
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { ExportPrerenderStatus } from '../types';
import { useStore } from '../store';
import type { AppStore } from '../store/types';
import { prepareExportCapture } from '../lib/export/captureParams';
import { buildExportSettings, loadStoredExportSettings } from '../lib/export/exportSettingsStorage';
import {
  PRERENDER_ACTIVE_DUTY_CYCLE,
  PRERENDER_IDLE_DUTY_CYCLE,
} from '../lib/export/captureScheduling';
import { isPreviewDrawing, onPreviewDrawingChanged } from '../lib/pixi/previewActivity';

export { PRERENDER_ACTIVE_DUTY_CYCLE, PRERENDER_IDLE_DUTY_CYCLE };

/** Wait after the last edit before (re)starting. */
export const PRERENDER_EDIT_DELAY_MS = 1_000;
/** Wait after the playhead last moved before resuming. */
export const PRERENDER_PLAYBACK_DELAY_MS = 1_500;
/**
 * How long the editor must have been still (preview asleep, no click, key or
 * scroll) before the pre-render goes back to full speed. Holding it is
 * immediate; this keeps the pace from flapping between edits a moment apart.
 */
export const PRERENDER_IDLE_SETTLE_MS = 500;
/** Input that holds the pre-render, caught before the editor handles it. */
const PRERENDER_BRAKE_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/** The store fields an export's pixels depend on. */
const EXPORT_STATE_FIELDS: ReadonlyArray<keyof AppStore> = [
  'recordingResult',
  'mediaSegments',
  'frame',
  'zoomClips',
  'textClips',
  'camera',
  'keyboard',
  'captions',
  'cursorEnabled',
  'cursorStyle',
  'cursorSize',
  'cursorClickEffect',
  'cursorHalflife',
  'cursorMotionBlur',
  'cursorMaxTilt',
  'cursorHideWhenIdle',
  'cursorIdleHideSeconds',
  'cursorEffect',
  'cursorClickShrink',
  'cursorColor',
  'cursorLabel',
  'cameraClips',
  'maskClips',
  'motionClips',
  'hiddenLayers',
];

export function exportStateChanged(prev: AppStore, next: AppStore): boolean {
  return EXPORT_STATE_FIELDS.some((field) => prev[field] !== next[field]);
}

interface PrerenderState {
  /** Bumped whenever an export-relevant part of the editor state changes. */
  stateVersion: number;
  /** The settings the latest pre-render used, as a comparable string. */
  settingsKey: string | null;
  status: ExportPrerenderStatus | null;
  /** Power does not allow it (battery below 30%), so nothing is being prepared. */
  blocked: boolean;
}

export const usePrerenderStore = create<PrerenderState>(() => ({
  stateVersion: 0,
  settingsKey: null,
  status: null,
  blocked: false,
}));

export function prerenderSettingsKey(settings: {
  format: string;
  resolution: string;
  fps: number;
  quality: string;
}): string {
  return `${settings.format}|${settings.resolution}|${settings.fps}|${settings.quality}`;
}

/**
 * How much of the export is ready for these settings, or null when unknown
 * (the project changed since the last pre-render, or it used other settings).
 */
export function selectPrerenderReadiness(
  state: Pick<PrerenderState, 'status' | 'stateVersion' | 'settingsKey'>,
  settingsKey: string,
): { total: number; cached: number } | null {
  const { status } = state;
  if (
    !status ||
    status.total === 0 ||
    status.stateVersion !== state.stateVersion ||
    state.settingsKey !== settingsKey
  ) {
    return null;
  }
  return { total: status.total, cached: Math.min(status.cached, status.total) };
}

export function useExportPrerender(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let disposed = false;
    // True from a playhead move until the delayed restart fires.
    let paused = false;
    // A restart came due while the previous pre-render was still stopping.
    let restartWhenStopped = false;
    // The pace: held while someone uses the editor, flat out once it has been
    // still for PRERENDER_IDLE_SETTLE_MS, or while the window is hidden (its
    // preview cannot draw then). Sent on every change; the main process keeps
    // it for a pre-render that is starting.
    let dutyCycle = PRERENDER_ACTIVE_DUTY_CYCLE;
    // When the editor was last in use: a click, key or scroll, or the preview
    // going to sleep. Starts in use, so a fresh pre-render waits for stillness.
    let lastActiveAt = performance.now();
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const updatePace = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      const drawing = isPreviewDrawing();
      const stillFor = performance.now() - lastActiveAt;
      const inUse = !document.hidden && (drawing || stillFor < PRERENDER_IDLE_SETTLE_MS);
      const next = inUse ? PRERENDER_ACTIVE_DUTY_CYCLE : PRERENDER_IDLE_DUTY_CYCLE;
      if (next !== dutyCycle) {
        dutyCycle = next;
        window.screenforge.setExportPrerenderPace(next);
      }
      if (inUse && !drawing) {
        idleTimer = setTimeout(updatePace, PRERENDER_IDLE_SETTLE_MS - stillFor);
      }
    };
    const onPreviewDrawing = (drawing: boolean) => {
      if (!drawing) {
        lastActiveAt = performance.now();
      }
      updatePace();
    };
    // Capture phase: hold the pre-render before the editor reacts to the input,
    // so the frame that shows its result is not queued behind pre-render work.
    const onInput = () => {
      lastActiveAt = performance.now();
      updatePace();
    };
    for (const type of PRERENDER_BRAKE_EVENTS) {
      window.addEventListener(type, onInput, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', updatePace);
    const unsubscribePreview = onPreviewDrawingChanged(onPreviewDrawing);
    updatePace();

    const stop = () => {
      if (running) {
        void window.screenforge.stopExportPrerender().catch(() => undefined);
      }
    };

    const start = async () => {
      timer = null;
      paused = false;
      const state = useStore.getState();
      if (running) {
        restartWhenStopped = true;
        return;
      }
      if (disposed || state.isExporting || !state.recordingResult) {
        return;
      }
      // Read with `state`, so an edit during the waits below (captions
      // turned off, say) makes this start stale instead of rendering old state.
      const stateVersion = usePrerenderStore.getState().stateVersion;
      // Reserved before the first wait, so a second start cannot slip in.
      running = true;
      try {
        try {
          if (!(await window.screenforge.canPrerenderOnPower())) {
            usePrerenderStore.setState({ blocked: true });
            return;
          }
        } catch {
          return;
        }
        const stored = loadStoredExportSettings();
        const settings = buildExportSettings(stored, state.captions);
        const prepared = await prepareExportCapture(settings);
        if (paused) {
          return;
        }
        if (disposed || usePrerenderStore.getState().stateVersion !== stateVersion) {
          return;
        }
        usePrerenderStore.setState({ settingsKey: prerenderSettingsKey(stored), blocked: false });
        await window.screenforge.startExportPrerender({
          ...prepared.params,
          workspaceId: '',
          jobId: `prerender-${Date.now()}`,
          includeAudio: false,
          chunking: 'prerender',
          stateVersion,
          dutyCycle,
        });
      } catch {
        // Pre-rendering is best effort; the export renders anything missing.
      } finally {
        running = false;
        if (restartWhenStopped && !disposed && !timer) {
          restartWhenStopped = false;
          void start();
        }
      }
    };

    const schedule = (delayMs: number) => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => void start(), delayMs);
    };

    const unsubscribeStore = useStore.subscribe((next, prev) => {
      if (next.isExporting) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        stop();
        return;
      }
      if (exportStateChanged(prev, next)) {
        // The running plan is stale: restart once the edit settles.
        usePrerenderStore.setState((s) => ({ stateVersion: s.stateVersion + 1 }));
        stop();
        schedule(PRERENDER_EDIT_DELAY_MS);
      } else if (next.currentTime !== prev.currentTime) {
        // Playing or scrubbing: give the preview the GPU.
        paused = true;
        stop();
        schedule(PRERENDER_PLAYBACK_DELAY_MS);
      } else if (prev.isExporting) {
        // An export just finished or was cancelled.
        schedule(PRERENDER_EDIT_DELAY_MS);
      }
    });
    const unsubscribeStatus = window.screenforge.onPrerenderStatus((status) => {
      usePrerenderStore.setState({ status });
    });
    // Plugged in or out, or the battery crossed 30%. The main process stops a
    // running pre-render itself when power no longer allows it.
    const unsubscribePower = window.screenforge.onPrerenderPowerChanged((allowed) => {
      if (allowed) {
        if (usePrerenderStore.getState().blocked) {
          usePrerenderStore.setState({ blocked: false });
          schedule(PRERENDER_EDIT_DELAY_MS);
        }
      } else {
        usePrerenderStore.setState({ blocked: true });
      }
    });

    schedule(PRERENDER_EDIT_DELAY_MS);

    return () => {
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      stop();
      unsubscribePreview();
      for (const type of PRERENDER_BRAKE_EVENTS) {
        window.removeEventListener(type, onInput, { capture: true });
      }
      document.removeEventListener('visibilitychange', updatePace);
      unsubscribeStore();
      unsubscribeStatus();
      unsubscribePower();
    };
  }, [enabled]);
}
