import { createScreenforgeFileUrl } from '../../screenforge-url';
import type { RecordingResult, ProjectCameraSettings } from '../../../types';
import type { ZoomClip } from '../../../types/timeline';
import { useStore } from '../../../store';
import {
  mapTimelineTimeToSource,
  mapSourceTimeToTimelineTime,
  findSegmentAtTime,
} from '../../helpers/segments';
import { interpolateCamera } from '../zoom/render';
import type { Effect, RenderContext, RenderSource } from '../types';
import { resolveCameraAtTime, getCameraCornerRadius } from './layout';
import type { CameraRect } from './layout';

interface CameraData {
  cameraPath: string | null;
}

let previewCameraVideo: HTMLVideoElement | null = null;
let previewCameraPath: string | null = null;

interface CameraDrawLayout {
  rect: CameraRect;
  radius: number;
  coverRect: { sx: number; sy: number; sw: number; sh: number };
  shadowOpacity: number;
  shadowBlur: number;
}

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
  video.src = createScreenforgeFileUrl(path);
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.load();
  previewCameraVideo = video;
  previewCameraPath = path;
  return video;
}

function drawCameraSource(
  ctx: CanvasRenderingContext2D,
  camera: ProjectCameraSettings,
  source: CanvasImageSource,
  layout: CameraDrawLayout,
): void {
  const { rect, radius, coverRect, shadowOpacity, shadowBlur } = layout;

  ctx.save();

  if (shadowBlur > 0 && shadowOpacity > 0) {
    const shadowStrength = Math.min(1, shadowOpacity * 1.15);
    ctx.shadowColor = `rgba(12, 12, 16, ${shadowStrength})`;
    ctx.shadowBlur = Math.max(0.5, shadowBlur);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.max(1, shadowBlur * 0.22);
    ctx.fillStyle = '#0c0c10';
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  ctx.clip();

  if (camera.backgroundBlur > 0) {
    ctx.filter = `blur(${camera.backgroundBlur}px)`;
  }

  if (camera.mirror) {
    ctx.translate(rect.x + rect.width, rect.y);
    ctx.scale(-1, 1);
    ctx.drawImage(
      source,
      coverRect.sx,
      coverRect.sy,
      coverRect.sw,
      coverRect.sh,
      0,
      0,
      rect.width,
      rect.height,
    );
  } else {
    ctx.drawImage(
      source,
      coverRect.sx,
      coverRect.sy,
      coverRect.sw,
      coverRect.sh,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    );
  }

  ctx.restore();
}

function buildDrawLayout(
  rect: CameraRect,
  radius: number,
  camera: ProjectCameraSettings,
  sourceWidth: number,
  sourceHeight: number,
  canvasHeight: number,
  shadowOverride?: { blur: number; opacity: number },
): CameraDrawLayout {
  const blur = shadowOverride !== undefined ? shadowOverride.blur : camera.shadow.blur;
  const opacity = shadowOverride !== undefined ? shadowOverride.opacity : camera.shadow.opacity;
  return {
    rect,
    radius,
    coverRect: resolveCoverSourceRect(sourceWidth, sourceHeight, rect.width, rect.height),
    shadowOpacity: clamp(opacity, 0, 1),
    shadowBlur: Math.max(0, blur) * (canvasHeight / 1080),
  };
}

// Mirrors layout.ts SIDE_LAYOUT_POPOUT_END_ZOOM — kept in sync manually.
const SIDE_LAYOUT_POPOUT_END_ZOOM_2D = 1.3;

function getSidePopoutAlpha2D(zoomScale: number): number {
  const t = Math.max(0, Math.min(1, (zoomScale - 1) / (SIDE_LAYOUT_POPOUT_END_ZOOM_2D - 1)));
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

export function createCameraExportRenderer(options: {
  camera: ProjectCameraSettings;
  zoomClips: ZoomClip[];
  cameraClips: import('../../../types/timeline').CameraClip[];
  canvasWidth: number;
  canvasHeight: number;
}): (ctx: CanvasRenderingContext2D, timelineTime: number, renderContext?: RenderContext) => void {
  const { camera, zoomClips, cameraClips, canvasWidth, canvasHeight } = options;
  const hasDynamicZoom = zoomClips.length > 0;
  let lastLayoutKey: string | null = null;
  let lastLayout: CameraDrawLayout | null = null;

  return (ctx, timelineTime, renderContext) => {
    if (!camera.enabled) {
      return;
    }

    const source = resolveExportCameraSource(renderContext);
    if (!source || !source.ready || source.width === 0 || source.height === 0) {
      return;
    }

    const zoomScale = hasDynamicZoom ? (interpolateCamera(zoomClips, timelineTime)?.scale ?? 1) : 1;
    const resolved = resolveCameraAtTime(
      cameraClips,
      timelineTime,
      camera,
      canvasWidth,
      canvasHeight,
      zoomScale,
    );
    if (!resolved) {
      return;
    }

    const { rect } = resolved;
    const isFixedRnd = resolved.layout === 'left' || resolved.layout === 'right';
    const popoutAlphaRnd = isFixedRnd ? getSidePopoutAlpha2D(zoomScale) : 0;
    const { frame: frameRnd } = useStore.getState();
    const panelRadiusRnd = Math.max(0, frameRnd.background.cornerRadius * (canvasHeight / 1080));
    const pipRadiusRnd = getCameraCornerRadius(camera, rect.width, rect.height);
    const effectiveRadiusRnd = isFixedRnd
      ? panelRadiusRnd + (pipRadiusRnd - panelRadiusRnd) * popoutAlphaRnd
      : resolved.radius;
    const shadowOverrideRnd = isFixedRnd
      ? {
          blur:
            frameRnd.background.shadowBlur * (1 - popoutAlphaRnd) +
            camera.shadow.blur * popoutAlphaRnd,
          opacity:
            frameRnd.background.shadowOpacity * (1 - popoutAlphaRnd) +
            clamp(camera.shadow.opacity, 0, 1) * popoutAlphaRnd,
        }
      : undefined;

    const layoutKey = [
      rect.x.toFixed(2),
      rect.y.toFixed(2),
      rect.width.toFixed(2),
      rect.height.toFixed(2),
      effectiveRadiusRnd.toFixed(2),
      source.width,
      source.height,
      camera.mirror ? 1 : 0,
      camera.backgroundBlur,
      shadowOverrideRnd ? shadowOverrideRnd.blur : camera.shadow.blur,
      shadowOverrideRnd ? shadowOverrideRnd.opacity : camera.shadow.opacity,
    ].join(':');

    if (!lastLayout || lastLayoutKey !== layoutKey) {
      lastLayout = buildDrawLayout(
        rect,
        effectiveRadiusRnd,
        camera,
        source.width,
        source.height,
        canvasHeight,
        shadowOverrideRnd,
      );
      lastLayoutKey = layoutKey;
    }

    drawCameraSource(ctx, camera, source.source, lastLayout);
  };
}

function resolveExportCameraSource(renderContext?: RenderContext): RenderSource | null {
  return renderContext?.cameraSource ?? null;
}

export function drawCameraExportFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  timelineTime: number,
  renderContext?: RenderContext,
): void {
  const state = useStore.getState();
  if (!state.camera.enabled) {
    return;
  }

  const source = resolveExportCameraSource(renderContext);
  if (!source || !source.ready || source.width === 0 || source.height === 0) {
    return;
  }

  const zoomScale = interpolateCamera(state.zoomClips, timelineTime)?.scale ?? 1;
  const resolved = resolveCameraAtTime(
    state.cameraClips,
    timelineTime,
    state.camera,
    canvasWidth,
    canvasHeight,
    zoomScale,
  );
  if (!resolved) {
    return;
  }

  const isFixedExp = resolved.layout === 'left' || resolved.layout === 'right';
  const popoutAlphaExp = isFixedExp ? getSidePopoutAlpha2D(zoomScale) : 0;
  const panelRadiusExp = Math.max(0, state.frame.background.cornerRadius * (canvasHeight / 1080));
  const pipRadiusExp = getCameraCornerRadius(
    state.camera,
    resolved.rect.width,
    resolved.rect.height,
  );
  const effectiveRadiusExp = isFixedExp
    ? panelRadiusExp + (pipRadiusExp - panelRadiusExp) * popoutAlphaExp
    : resolved.radius;
  const shadowOverrideExp = isFixedExp
    ? {
        blur:
          state.frame.background.shadowBlur * (1 - popoutAlphaExp) +
          state.camera.shadow.blur * popoutAlphaExp,
        opacity:
          state.frame.background.shadowOpacity * (1 - popoutAlphaExp) +
          clamp(state.camera.shadow.opacity, 0, 1) * popoutAlphaExp,
      }
    : undefined;

  drawCameraSource(
    ctx,
    state.camera,
    source.source,
    buildDrawLayout(
      resolved.rect,
      effectiveRadiusExp,
      state.camera,
      source.width,
      source.height,
      canvasHeight,
      shadowOverrideExp,
    ),
  );
}

export const cameraEffect: Effect<CameraData> = {
  id: 'camera',

  analyze(recording: RecordingResult) {
    return { cameraPath: recording.cameraPath ?? null };
  },

  createLayer(data) {
    const video = ensurePreviewCameraVideo(data?.cameraPath ?? null);
    if (!video) {
      return null;
    }

    let lastSourceTime: number | null = null;
    let hasFrame = false;

    return {
      phase: 'overlay',
      draw(ctx, t, _sourceWidth, _sourceHeight, canvasWidth, canvasHeight) {
        const state = useStore.getState();
        if (!state.camera.enabled) {
          return;
        }

        // t is source time (video.currentTime). Convert to timeline time for camera lookups.
        const timelineT = mapSourceTimeToTimelineTime(state.mediaSegments, t) ?? t;

        const sourceTime = mapTimelineTimeToSource(state.cameraMediaSegments, timelineT);
        if (sourceTime === null) {
          return;
        }
        const maxSourceTime = Number.isFinite(video.duration)
          ? Math.max(0, video.duration - 1 / 30)
          : null;
        const resolvedSourceTime =
          maxSourceTime === null ? sourceTime : Math.min(Math.max(sourceTime, 0), maxSourceTime);

        // In editor preview, avoid hard-seeking every RAF (causes visible flicker on many devices).
        // In export capture, keep deterministic seek-based sync for frame-accurate output.
        const isLivePreview = Math.abs(state.currentTime - timelineT) < 0.08;
        const sourceDelta = lastSourceTime == null ? 0 : resolvedSourceTime - lastSourceTime;
        const isAdvancing = Math.abs(sourceDelta) > 1 / 240;
        const didJump = Math.abs(sourceDelta) > 0.35;

        if (!isLivePreview) {
          if (Math.abs(video.currentTime - resolvedSourceTime) > 1 / 120) {
            try {
              video.currentTime = resolvedSourceTime;
            } catch {
              return;
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
            const cameraSegment = findSegmentAtTime(state.cameraMediaSegments, timelineT);
            const effectivePlaybackRate = cameraSegment?.speed ?? 1;
            if (video.playbackRate !== effectivePlaybackRate) {
              video.playbackRate = effectivePlaybackRate;
            }
            if (didJump || Math.abs(video.currentTime - resolvedSourceTime) > 0.16) {
              try {
                video.currentTime = resolvedSourceTime;
              } catch {
                return;
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
                return;
              }
            }
          }
        }
        lastSourceTime = resolvedSourceTime;

        if (video.videoWidth === 0 || video.videoHeight === 0) {
          return;
        }
        if (!hasFrame && video.readyState < 2) {
          return;
        }

        const zoomScale = interpolateCamera(state.zoomClips, timelineT)?.scale ?? 1;
        const resolved = resolveCameraAtTime(
          state.cameraClips,
          timelineT,
          state.camera,
          canvasWidth,
          canvasHeight,
          zoomScale,
        );
        if (!resolved) {
          return;
        }

        const isFixed2D = resolved.layout === 'left' || resolved.layout === 'right';
        const popoutAlpha2D = isFixed2D ? getSidePopoutAlpha2D(zoomScale) : 0;
        const panelRadius2D = Math.max(
          0,
          state.frame.background.cornerRadius * (canvasHeight / 1080),
        );
        const pipRadius2D = getCameraCornerRadius(
          state.camera,
          resolved.rect.width,
          resolved.rect.height,
        );
        const effectiveRadius2D = isFixed2D
          ? panelRadius2D + (pipRadius2D - panelRadius2D) * popoutAlpha2D
          : resolved.radius;
        const shadowOverride2D = isFixed2D
          ? {
              blur:
                state.frame.background.shadowBlur * (1 - popoutAlpha2D) +
                state.camera.shadow.blur * popoutAlpha2D,
              opacity:
                state.frame.background.shadowOpacity * (1 - popoutAlpha2D) +
                clamp(state.camera.shadow.opacity, 0, 1) * popoutAlpha2D,
            }
          : undefined;

        drawCameraSource(
          ctx,
          state.camera,
          video,
          buildDrawLayout(
            resolved.rect,
            effectiveRadius2D,
            state.camera,
            video.videoWidth,
            video.videoHeight,
            canvasHeight,
            shadowOverride2D,
          ),
        );
        hasFrame = true;
      },
    };
  },
};
