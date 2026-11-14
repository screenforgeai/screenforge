import { createScreenforgeFileUrl } from '../../screenforge-url';
/**
 * Camera PIP effect — PixiJS implementation.
 *
 * Renders the camera overlay using PixiJS Sprites with:
 *   - Cover-crop positioning (fills dest rect from source center)
 *   - Graphics mask for rounded corners
 *   - For left/right fixed layouts: a separate blurred Graphics shadow (same style as
 *     the recording frame) and corner radius from frame.background.cornerRadius.
 *   - For pip layout: DropShadowFilter for the drop shadow and camera.roundness radius.
 *   - BlurFilter on the sprite for background blur
 *   - Mirror via negative x-scale
 *
 * Lives in scene.overlayContainer — not subject to the zoom Container
 * transform. The preview uses an HTMLVideoElement with the same seek/play
 * logic as the Canvas 2D version. Export reads from renderContext.cameraSource.
 */
import { Container, Sprite, Graphics, Texture, BlurFilter, CanvasSource } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';
import type { PixiEffect, PixiEffectUpdater } from '../../pixi/types';
import { smoothFilterEdges } from '../../pixi/smoothEdges';
import type { RenderContext } from '../types';
import { useStore } from '../../../store';
import {
  mapTimelineTimeToSource,
  mapSourceTimeToTimelineTime,
  findSegmentAtTime,
} from '../../helpers/segments';
import { interpolateCamera } from '../zoom/render';
import { resolveCameraAtTime, type ResolvedCameraLayout } from './layout';
import type { ZoomClip } from '../../../types/timeline';

// Mirrors layout.ts constants — kept in sync manually so we don't need to export them.
const SIDE_LAYOUT_POPOUT_END_ZOOM = 1.3;

function getSidePopoutAlpha(zoomScale: number): number {
  const t = Math.max(0, Math.min(1, (zoomScale - 1) / (SIDE_LAYOUT_POPOUT_END_ZOOM - 1)));
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CameraData {
  cameraPath: string | null;
}

// ── Cover-crop helper (mirrors Canvas 2D version verbatim) ────────────────────

function resolveCoverSourceRect(
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(
    destWidth / Math.max(sourceWidth, 1),
    destHeight / Math.max(sourceHeight, 1),
  );
  const sw = destWidth / Math.max(scale, 0.001);
  const sh = destHeight / Math.max(scale, 0.001);
  return {
    sx: Math.max(0, (sourceWidth - sw) / 2),
    sy: Math.max(0, (sourceHeight - sh) / 2),
    sw: Math.min(sourceWidth, sw),
    sh: Math.min(sourceHeight, sh),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c;
}

const CAMERA_FADE_OUT_S = 0.4;

// ── Preview video management (module-level singleton) ─────────────────────────
// Mirrors the Canvas 2D camera effect's ensurePreviewCameraVideo pattern.

let previewCameraVideo: HTMLVideoElement | null = null;
let previewCameraPath: string | null = null;

function ensurePreviewCameraVideo(path: string | null): HTMLVideoElement | null {
  if (!path) {
    disposePreviewCameraVideo();
    return null;
  }
  if (previewCameraVideo && previewCameraPath === path) {
    return previewCameraVideo;
  }
  disposePreviewCameraVideo();
  const video = document.createElement('video');
  // screenforge:// is cross-origin to the app page; without CORS mode WebGL
  // refuses to upload the frames.
  video.crossOrigin = 'anonymous';
  video.src = createScreenforgeFileUrl(path);
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.load();
  previewCameraVideo = video;
  previewCameraPath = path;
  return video;
}

function disposePreviewCameraVideo(): void {
  if (!previewCameraVideo) {
    previewCameraPath = null;
    return;
  }
  previewCameraVideo.pause();
  previewCameraVideo.removeAttribute('src');
  previewCameraVideo.load();
  previewCameraVideo = null;
  previewCameraPath = null;
}

// ── Camera effect ─────────────────────────────────────────────────────────────

export const cameraPixiEffect: PixiEffect<CameraData> = {
  id: 'camera',

  analyze(recording) {
    return { cameraPath: recording.cameraPath ?? null };
  },

  setup(data, _allData, scene): PixiEffectUpdater {
    window.screenforge.writeDiagnosticLog('camera-pixi.setup');
    const video = ensurePreviewCameraVideo(data.cameraPath);

    // ── Display objects ────────────────────────────────────────────────────
    const cameraSprite = new Sprite();
    cameraSprite.eventMode = 'none';

    // Blur filter applied only to the video sprite (backgroundBlur setting).
    const blurFilter = new BlurFilter({ strength: 0, quality: 3 });
    // Start with no filters — applied conditionally in updater.

    // Clip mask: rounded rectangle drawn each frame.
    const clipMask = new Graphics();
    clipMask.eventMode = 'none';

    // Inner container clipped to the rect — DropShadowFilter on the parent
    // lets the shadow project into overlayContainer space outside the clip.
    const cameraContainer = new Container();
    cameraContainer.eventMode = 'none';
    cameraContainer.mask = clipMask;
    cameraContainer.addChild(clipMask, cameraSprite);

    // DropShadowFilter on cameraContainer — used for pip layout only. It wraps the camera's
    // round clip: keep that edge antialiased.
    const dropShadow = smoothFilterEdges(new DropShadowFilter());
    dropShadow.color = 0x0c0c10;

    // Camera frame shadow — used for left/right fixed layouts.
    // Rendered as a separate blurred Graphics shape (same approach as the recording
    // frame shadow) so it matches the recording's shadow style exactly.
    const cameraFrameShadow = new Graphics();
    cameraFrameShadow.eventMode = 'none';
    cameraFrameShadow.visible = false;
    const cameraFrameBlurFilter = new BlurFilter({ strength: 0, quality: 3 });

    // Frame shadow sits behind camera container in the overlay.
    scene.overlayContainer.addChild(cameraFrameShadow, cameraContainer);

    // ── Per-frame state ────────────────────────────────────────────────────
    let lastSourceTime: number | null = null;
    let hasFrame = false;
    let lastShadowKey = '';
    let lastFrameShadowKey = '';
    let lastBlur = -1;

    // ── Camera bridge canvas (CPU bridge: drawImage → CanvasSource → GPU) ───
    // Handles both export (OffscreenCanvas from mediabunny) and preview
    // (HTMLVideoElement) without VideoSource Ticker dependency.
    const cameraBridgeCanvas = document.createElement('canvas');
    const cameraBridgeCtx = cameraBridgeCanvas.getContext('2d');
    if (!cameraBridgeCtx) {
      console.error('[CameraEffect] Failed to get 2D context for camera bridge canvas');
    }
    let cameraBridgeSource: CanvasSource | null = null;
    let persistentCameraTexture: Texture | null = null;

    // ── Camera fade-out state ──────────────────────────────────────────────
    let lastResolvedLayout: ResolvedCameraLayout | null = null;
    let cameraFadeElapsed = 0;

    // ── Updater ────────────────────────────────────────────────────────────
    return (t, dt, renderContext: RenderContext) => {
      const state = useStore.getState();
      const { camera, zoomClips, mediaSegments, cameraMediaSegments, currentTime, frame } = state;

      if (!camera.enabled) {
        cameraContainer.visible = false;
        cameraFrameShadow.visible = false;
        cameraContainer.alpha = 1;
        lastResolvedLayout = null;
        cameraFadeElapsed = 0;
        return;
      }

      // t is source time (video.currentTime). Camera clips and cameraMediaSegments
      // use timeline time. Convert once here so all camera logic uses the same coordinate.
      const timelineT = mapSourceTimeToTimelineTime(mediaSegments, t) ?? t;

      const cw = scene.app.renderer.width;
      const ch = scene.app.renderer.height;

      // ── Resolve camera texture and source dimensions ───────────────────
      let srcW = 0;
      let srcH = 0;

      const exportSource = renderContext.cameraSource;
      if (cameraBridgeCtx && exportSource?.ready && exportSource.source && exportSource.width > 0) {
        // Export path — use frame-accurate source from renderContext.
        srcW = exportSource.width;
        srcH = exportSource.height;
        const src = exportSource.source;
        if (cameraBridgeCanvas.width !== srcW || cameraBridgeCanvas.height !== srcH) {
          cameraBridgeCanvas.width = srcW;
          cameraBridgeCanvas.height = srcH;
        }
        cameraBridgeCtx.drawImage(src as CanvasImageSource, 0, 0);
        if (!cameraBridgeSource) {
          cameraBridgeSource = new CanvasSource({ resource: cameraBridgeCanvas });
          persistentCameraTexture = new Texture({ source: cameraBridgeSource });
        }
        cameraBridgeSource.update();
      } else if (video) {
        // Preview path — manage video element seek/play, identical to Canvas 2D.
        const sourceTime = mapTimelineTimeToSource(cameraMediaSegments, timelineT);

        if (sourceTime !== null) {
          const maxSourceTime = Number.isFinite(video.duration)
            ? Math.max(0, video.duration - 1 / 30)
            : null;
          const resolvedSourceTime =
            maxSourceTime === null ? sourceTime : Math.min(Math.max(sourceTime, 0), maxSourceTime);

          const isLivePreview = Math.abs(currentTime - timelineT) < 0.08;
          const sourceDelta = lastSourceTime == null ? 0 : resolvedSourceTime - lastSourceTime;
          const isAdvancing = Math.abs(sourceDelta) > 1 / 240;
          const didJump = Math.abs(sourceDelta) > 0.35;

          if (!isLivePreview) {
            if (Math.abs(video.currentTime - resolvedSourceTime) > 1 / 120) {
              try {
                video.currentTime = resolvedSourceTime;
              } catch {
                // ignore
              }
            }
            if (!video.paused) {
              video.pause();
            }
          } else {
            if (isAdvancing) {
              if (video.paused) {
                video.play().catch(() => undefined);
              }
              const cameraSegment = findSegmentAtTime(cameraMediaSegments, timelineT);
              const effectivePlaybackRate = cameraSegment?.speed ?? 1;
              if (video.playbackRate !== effectivePlaybackRate) {
                video.playbackRate = effectivePlaybackRate;
              }
              if (didJump || Math.abs(video.currentTime - resolvedSourceTime) > 0.16) {
                try {
                  video.currentTime = resolvedSourceTime;
                } catch {
                  // ignore
                }
              }
            } else {
              if (!video.paused) {
                video.pause();
              }
              if (Math.abs(video.currentTime - resolvedSourceTime) > 1 / 90) {
                try {
                  video.currentTime = resolvedSourceTime;
                } catch {
                  // ignore
                }
              }
            }
          }

          lastSourceTime = resolvedSourceTime;

          if (video.videoWidth > 0 && video.videoHeight > 0) {
            if (!hasFrame && video.readyState < 2) {
              cameraContainer.visible = false;
              return;
            }
            srcW = video.videoWidth;
            srcH = video.videoHeight;
            hasFrame = true;
            if (cameraBridgeCanvas.width !== srcW || cameraBridgeCanvas.height !== srcH) {
              cameraBridgeCanvas.width = srcW;
              cameraBridgeCanvas.height = srcH;
            }
            if (video.readyState >= 2 && cameraBridgeCtx) {
              cameraBridgeCtx.drawImage(video, 0, 0);
            }
            if (!cameraBridgeSource) {
              cameraBridgeSource = new CanvasSource({ resource: cameraBridgeCanvas });
              persistentCameraTexture = new Texture({ source: cameraBridgeSource });
            }
            cameraBridgeSource.update();
          }
        }
      }

      // Use last known dimensions when clip ends (sourceTime=null → srcW/srcH stay 0).
      const effectiveSrcW = srcW > 0 ? srcW : cameraBridgeCanvas.width;
      const effectiveSrcH = srcH > 0 ? srcH : cameraBridgeCanvas.height;
      if (!persistentCameraTexture || effectiveSrcW === 0 || effectiveSrcH === 0) {
        cameraContainer.visible = false;
        cameraFrameShadow.visible = false;
        lastResolvedLayout = null;
        cameraFadeElapsed = 0;
        return;
      }

      // ── Layout ─────────────────────────────────────────────────────────
      const zoomScale = interpolateCamera(zoomClips as ZoomClip[], timelineT)?.scale ?? 1;
      const resolved = resolveCameraAtTime(state.cameraClips, timelineT, camera, cw, ch, zoomScale);

      // Fade out smoothly when a clip ends with no following clip / gap between clips.
      // Export uses hard cut (frame-accurate); fade only runs in preview mode.
      const isPreviewMode = !renderContext.cameraSource?.ready;
      let effectiveResolved: ResolvedCameraLayout | null = resolved;
      let ghostAlpha = 1;
      if (resolved !== null) {
        if (isPreviewMode) {
          lastResolvedLayout = resolved;
          cameraFadeElapsed = 0;
        }
      } else if (isPreviewMode && lastResolvedLayout !== null) {
        cameraFadeElapsed = Math.min(cameraFadeElapsed + dt, CAMERA_FADE_OUT_S);
        ghostAlpha = 1 - easeInOut(cameraFadeElapsed / CAMERA_FADE_OUT_S);
        if (ghostAlpha > 0) {
          effectiveResolved = lastResolvedLayout;
        } else {
          lastResolvedLayout = null;
        }
      }

      if (!effectiveResolved) {
        cameraContainer.visible = false;
        cameraFrameShadow.visible = false;
        scene.compositeContainer.scale.set(1);
        scene.compositeContainer.position.set(0, 0);
        return;
      }
      cameraContainer.visible = true;
      cameraContainer.alpha = ghostAlpha;

      const { rect, radius, layout } = effectiveResolved;
      const isFixed = layout === 'left' || layout === 'right';

      // ── Effective radius and shadow — lerp from frame style → pip style as popout progresses ──
      const popoutAlpha = isFixed ? getSidePopoutAlpha(zoomScale) : 0;
      const panelRadius = Math.max(0, camera.fixedRadius * (ch / 1080));
      const zoomRadius = Math.max(0, panelRadius * camera.zoomRadiusScale);
      const effectiveRadius = isFixed
        ? panelRadius + (zoomRadius - panelRadius) * popoutAlpha
        : radius;
      const effectiveShadowBlur = isFixed
        ? (frame.background.shadowBlur * (1 - popoutAlpha) +
            Math.max(0, camera.shadow.blur) * popoutAlpha) *
          (ch / 1080)
        : Math.max(0, camera.shadow.blur) * (ch / 1080);
      const effectiveShadowOpacity = isFixed
        ? clamp(
            frame.background.shadowOpacity * (1 - popoutAlpha) +
              clamp(camera.shadow.opacity, 0, 1) * popoutAlpha,
            0,
            1,
          )
        : clamp(camera.shadow.opacity, 0, 1);

      // compositeContainer stays at identity — recording panel geometry is driven by
      // the frame effect which reads screenRect and adjusts its contentRect/mediaRect.
      scene.compositeContainer.scale.set(1);
      scene.compositeContainer.position.set(0, 0);

      const { sx, sy, sw, sh } = resolveCoverSourceRect(
        effectiveSrcW,
        effectiveSrcH,
        rect.width,
        rect.height,
      );

      // ── Rounded clip mask ──────────────────────────────────────────────
      clipMask.clear();
      clipMask.roundRect(rect.x, rect.y, rect.width, rect.height, effectiveRadius);
      clipMask.fill(0xffffff);

      // ── Sprite: cover-crop with optional mirror ────────────────────────
      cameraSprite.texture = persistentCameraTexture;
      const scaleX = rect.width / Math.max(sw, 1);
      const scaleY = rect.height / Math.max(sh, 1);

      if (camera.mirror) {
        // Negative x-scale flips horizontally; adjust x so source sx maps to rect's right edge.
        cameraSprite.scale.x = -scaleX;
        cameraSprite.x = rect.x + rect.width + sx * scaleX;
      } else {
        cameraSprite.scale.x = scaleX;
        cameraSprite.x = rect.x - sx * scaleX;
      }
      cameraSprite.scale.y = scaleY;
      cameraSprite.y = rect.y - sy * scaleY;

      // ── Background blur filter ─────────────────────────────────────────
      if (camera.backgroundBlur !== lastBlur) {
        if (camera.backgroundBlur > 0) {
          blurFilter.blur = camera.backgroundBlur;
          cameraSprite.filters = [blurFilter];
        } else {
          cameraSprite.filters = null;
        }
        lastBlur = camera.backgroundBlur;
      }

      // ── Camera frame shadow (fixed layouts) ───────────────────────────
      // Rendered as a separate blurred shape in front of backgroundContainer so
      // it matches the recording frame shadow style exactly.
      const frameShadowKey = `${isFixed}|${effectiveShadowBlur.toFixed(3)}|${effectiveShadowOpacity.toFixed(3)}|${rect.x.toFixed(1)}|${rect.y.toFixed(1)}|${rect.width.toFixed(1)}|${rect.height.toFixed(1)}|${effectiveRadius.toFixed(2)}`;
      if (frameShadowKey !== lastFrameShadowKey) {
        if (isFixed && effectiveShadowBlur > 0 && effectiveShadowOpacity > 0) {
          const offsetY = effectiveShadowBlur * 0.25;
          cameraFrameShadow.x = 0;
          cameraFrameShadow.y = offsetY;
          cameraFrameShadow.clear();
          cameraFrameShadow
            .roundRect(rect.x, rect.y, rect.width, rect.height, effectiveRadius)
            .fill(0x000000);
          cameraFrameBlurFilter.blur = effectiveShadowBlur;
          cameraFrameShadow.filters = [cameraFrameBlurFilter];
          cameraFrameShadow.alpha = effectiveShadowOpacity;
          cameraFrameShadow.visible = true;
        } else {
          cameraFrameShadow.visible = false;
        }
        lastFrameShadowKey = frameShadowKey;
      }
      // Keep frame shadow opacity in sync with fade-out every frame.
      if (cameraFrameShadow.visible) {
        cameraFrameShadow.alpha = effectiveShadowOpacity * ghostAlpha;
      }

      // ── Drop shadow filter (pip layout only) ──────────────────────────
      const pipShadowBlur = isFixed ? 0 : Math.max(0, camera.shadow.blur) * (ch / 1080);
      const pipShadowOpacity = isFixed ? 0 : clamp(camera.shadow.opacity, 0, 1);
      const shadowKey = `${isFixed}|${pipShadowBlur.toFixed(3)}|${pipShadowOpacity.toFixed(3)}`;
      if (shadowKey !== lastShadowKey) {
        if (!isFixed && pipShadowBlur > 0 && pipShadowOpacity > 0) {
          dropShadow.alpha = Math.min(1, pipShadowOpacity * 1.15);
          dropShadow.blur = pipShadowBlur;
          dropShadow.offset = { x: 0, y: Math.max(1, pipShadowBlur * 0.22) };
          cameraContainer.filters = [dropShadow];
        } else {
          cameraContainer.filters = null;
        }
        // Reset mask after every filter change: PixiJS v8 does not re-initialize
        // stencil-based masking when a filter is removed from a container that
        // previously used a render-texture path (filter active). Without this
        // reset, fixed layouts render invisible after switching from pip.
        cameraContainer.mask = null;
        cameraContainer.mask = clipMask;
        lastShadowKey = shadowKey;
      }
    };
  },
};
