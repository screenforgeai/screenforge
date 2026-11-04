import { useMemo, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { RecordingResult } from '../types/index';
import { useStore } from '../store';
import { DEFAULT_CROP_RECT, getFrameGeometry } from '../lib/effects/frame';
import type { CursorData } from '../lib/effects/cursor';
import { playCursorClickSound } from '../lib/effects/cursor/audio';
import { createPreviewPixiApp, getPreviewRendererResolution } from '../lib/pixi/createPixiApp';
import type { PixiScene, PixiEffectUpdater } from '../lib/pixi/types';
import {
  analyzePixiEffects,
  runPixiEffectOnLoad,
  setupPixiPipeline,
  tickPixiPipeline,
} from '../lib/pixi/pipeline';

// ── Cursor click audio helpers ────────────────────────────────────────────────

function findLastClickIndexAtOrBefore(
  clickEvents: CursorData['clickEvents'],
  time: number,
): number {
  let lo = 0;
  let hi = clickEvents.length - 1;
  let prev = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (clickEvents[mid].t <= time) {
      prev = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return prev;
}

// ── Scene helpers ─────────────────────────────────────────────────────────────

/**
 * Removes all display objects added by previous effect setup calls,
 * resets filters/masks, and resets the camera/frame container transforms.
 * Called before re-running setupPixiPipeline with a new recording.
 */
function clearScene(scene: PixiScene): void {
  scene.backgroundContainer.removeChildren();
  scene.frameContainer.removeChildren();
  scene.frameContainer.addChild(scene.videoContainer);
  scene.videoContainer.removeChildren();
  scene.videoContainer.mask = null;
  scene.videoContainer.filters = null;
  scene.contentContainer.removeChildren();
  scene.overlayContainer.removeChildren();
  scene.compositeContainer.scale.set(1);
  scene.compositeContainer.pivot.set(0, 0);
  scene.compositeContainer.position.set(0, 0);
  scene.compositeContainer.mask = null;
  scene.cameraContainer.scale.set(1);
  scene.cameraContainer.pivot.set(0, 0);
  scene.cameraContainer.position.set(0, 0);
  scene.cameraContainer.rotation = 0;
  scene.cameraContainer.skew.set(0, 0);
  scene.cameraContainer.filters = null;
  scene.cameraContainer.filterArea = undefined;
  scene.frameContainer.scale.set(1);
  scene.frameContainer.pivot.set(0, 0);
  scene.frameContainer.position.set(0, 0);
  scene.frameContainer.rotation = 0;
  scene.frameContainer.skew.set(0, 0);
  scene.frameContainer.filters = null;
  scene.frameContainer.filterArea = undefined;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * PixiJS rendering pipeline for a recording.
 * Replaces useCanvasRenderer — same contract, GPU-accelerated rendering.
 *
 * - Creates a PixiJS Application attached to the provided canvas once.
 * - Re-runs the effect pipeline (analyze → setup) when the recording changes.
 * - Drives a single RAF loop that ticks all effect updaters, renders, and handles
 *   cursor-click audio. Previously two separate RAF loops; merged to halve
 *   RAF callbacks per second.
 */
export const usePixiRenderer = (
  canvasRef: RefObject<HTMLCanvasElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  recording: RecordingResult | null,
): void => {
  const frame = useStore((s) => s.frame);
  const isCropEditing = useStore((s) => s.isCropEditing);
  const cursorClickSound = useStore((s) => s.cursorClickSound);
  const cursorClickSoundVolume = useStore((s) => s.cursorClickSoundVolume);

  // ── Analyzed data (memoized per recording) ────────────────────────────────
  const analyzedData = useMemo(() => {
    if (!recording) {
      return new Map<string, unknown>();
    }
    return analyzePixiEffects(recording);
  }, [recording]);

  const cursorData = useMemo(
    () => (recording ? ((analyzedData.get('cursor') as CursorData | undefined) ?? null) : null),
    [analyzedData, recording],
  );

  // ── Audio state refs — updated without recreating the RAF loop ────────────
  // Sound settings sync into refs so the single RAF loop reads current values
  // without closing over them (which would require restarting the loop on change).
  const cursorClickSoundRef = useRef(cursorClickSound);
  const cursorClickSoundVolumeRef = useRef(cursorClickSoundVolume);
  useEffect(() => {
    cursorClickSoundRef.current = cursorClickSound;
  }, [cursorClickSound]);
  useEffect(() => {
    cursorClickSoundVolumeRef.current = cursorClickSoundVolume;
  }, [cursorClickSoundVolume]);

  // Audio playback state — reset when cursor data (recording) changes.
  const audioClickEventsRef = useRef<CursorData['clickEvents']>([]);
  const audioLastVideoTimeRef = useRef<number | null>(null);
  const audioLastPlayedIndexRef = useRef(-1);
  useEffect(() => {
    audioClickEventsRef.current = cursorData?.clickEvents ?? [];
    audioLastVideoTimeRef.current = null;
    audioLastPlayedIndexRef.current = -1;
  }, [cursorData]);

  // ── onLoad side effects ───────────────────────────────────────────────────
  useEffect(() => {
    if (!recording) {
      return;
    }
    runPixiEffectOnLoad(analyzedData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, analyzedData]);

  // ── PixiJS app lifecycle ──────────────────────────────────────────────────
  // The app is created once when the canvas mounts and destroyed on unmount.
  const sceneRef = useRef<PixiScene | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  // The effect updaters for the current scene; they close over it, so they
  // must never outlive it (see the scene cleanup below).
  const updatersRef = useRef<PixiEffectUpdater[]>([]);

  // Track only whether a recording is present (null vs. non-null).
  // Switching from R1 → R2 must NOT destroy the Pixi app — recreating a
  // WebGL renderer on the same canvas element immediately after destroying
  // the previous one puts the canvas in a broken state. The app is only
  // created/destroyed when the canvas enters or leaves the DOM (i.e. when
  // the recording transitions between null and non-null).
  const hasRecording = recording !== null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    let createdScene: PixiScene | null = null;

    createPreviewPixiApp(canvas)
      .then((scene) => {
        if (cancelled) {
          scene.app.destroy(false);
          return;
        }
        sceneRef.current = scene;
        createdScene = scene;
        setSceneReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('[PixiRenderer] Failed to initialize PixiJS app:', err);
        }
      });

    return () => {
      cancelled = true;
      if (createdScene) {
        createdScene.app.destroy(false);
        sceneRef.current = null;
        // Destroying the app nulls its renderer. The next scene can arrive
        // and render a frame before its own pipeline is set up, so drop
        // these now rather than letting it run them against a dead scene.
        updatersRef.current = [];
      }
      setSceneReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRecording]); // re-run only when canvas enters/leaves the DOM

  // ── Renderer resize when source dimensions or frame settings change ───────
  useEffect(() => {
    const video = videoRef.current;
    const scene = sceneRef.current;
    if (!video || !scene) {
      return;
    }

    const resize = (): void => {
      const sw = video.videoWidth || 1280;
      const sh = video.videoHeight || 800;
      // During crop editing, size the renderer to the full source so the overlay
      // (which uses DEFAULT_CROP_RECT geometry) aligns with the Pixi canvas.
      // When editing ends, resize to the confirmed crop dimensions.
      const { isCropEditing: editing } = useStore.getState();
      const targetFrame = editing ? { ...frame, cropRect: DEFAULT_CROP_RECT } : frame;
      const geometry = getFrameGeometry(targetFrame, sw, sh);
      const resolution = getPreviewRendererResolution();
      scene.sourceWidth = sw;
      scene.sourceHeight = sh;
      scene.app.renderer.resize(geometry.canvasWidth, geometry.canvasHeight, resolution);

      const canvas = scene.app.canvas as HTMLCanvasElement;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    };

    if (video.readyState >= 1) {
      resize();
    }
    video.addEventListener('loadedmetadata', resize);
    window.addEventListener('resize', resize);
    return () => {
      video.removeEventListener('loadedmetadata', resize);
      window.removeEventListener('resize', resize);
    };
  }, [sceneReady, frame, isCropEditing, videoRef]); // isCropEditing in deps triggers resize on enter/exit

  // ── Effect pipeline setup (async) ─────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!sceneReady || !scene || !recording) {
      return;
    }

    // Clear display objects from any previous recording.
    clearScene(scene);
    updatersRef.current = [];

    let cancelled = false;
    setupPixiPipeline(analyzedData, scene)
      .then((updaters) => {
        if (cancelled) {
          return;
        }
        updatersRef.current = updaters;
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('[PixiRenderer] Effect pipeline setup failed:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sceneReady, recording, analyzedData]);

  // ── Single RAF loop — audio + rendering ───────────────────────────────────
  // Cursor-click audio and Pixi rendering share one requestAnimationFrame loop
  // rather than running two parallel loops. This halves RAF callbacks from
  // ~120/s to ~60/s and eliminates the scheduling jitter between the two loops.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    let rafId: number;
    let lastFrameTime = performance.now();

    const tick = (): void => {
      rafId = requestAnimationFrame(tick);

      // ── Cursor-click audio tick ──────────────────────────────────────────
      const clickEvents = audioClickEventsRef.current;
      if (clickEvents.length > 0) {
        const currentTime = video.currentTime;
        const lastVideoTime = audioLastVideoTimeRef.current;
        const isPlaying = !video.paused && !video.ended && !video.seeking && video.readyState >= 2;
        const didJump =
          lastVideoTime !== null &&
          (currentTime + 0.001 < lastVideoTime || Math.abs(currentTime - lastVideoTime) > 0.25);

        if (!isPlaying || didJump) {
          audioLastPlayedIndexRef.current = findLastClickIndexAtOrBefore(clickEvents, currentTime);
          audioLastVideoTimeRef.current = currentTime;
        } else {
          const sound = cursorClickSoundRef.current;
          const volume = cursorClickSoundVolumeRef.current;
          if (sound !== 'none' && volume > 0) {
            let currentIndex = audioLastPlayedIndexRef.current + 1;
            while (
              currentIndex < clickEvents.length &&
              clickEvents[currentIndex].t <= currentTime + 0.0001
            ) {
              if (lastVideoTime !== null && clickEvents[currentIndex].t > lastVideoTime + 0.0001) {
                void playCursorClickSound(sound, volume);
              }
              currentIndex += 1;
            }
            audioLastPlayedIndexRef.current = currentIndex - 1;
          } else {
            audioLastPlayedIndexRef.current = findLastClickIndexAtOrBefore(
              clickEvents,
              currentTime,
            );
          }
          audioLastVideoTimeRef.current = currentTime;
        }
      }

      // ── Pixi render tick ─────────────────────────────────────────────────
      const scene = sceneRef.current;
      if (!scene || video.videoWidth === 0) {
        return;
      }

      const now = performance.now();
      const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;

      const t = video.currentTime;

      tickPixiPipeline(updatersRef.current, t, dt, {
        videoSource: {
          source: video,
          width: video.videoWidth,
          height: video.videoHeight,
          ready: video.readyState >= 2,
        },
      });

      scene.app.renderer.render(scene.app.stage);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, recording]); // re-run when recording changes so RAF starts once video is in the DOM
};
