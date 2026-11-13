/**
 * Frame effect — PixiJS implementation.
 *
 * Manages: background (solid/gradient/blur/wallpaper), rounded-corner masking,
 * drop shadow, and the video sprite (with crop support).
 *
 * Layer structure:
 *   frameContainer         — cinematic tilt target
 *   ├── shadowShape        — blurred preview shadow
 *   └── videoContainer     (masked to contentRect)
 *       ├── bgRepaintSprite — same background drawn inside content rect
 *       └── mediaContainer  (masked to windowRect: bar + page)
 *           ├── videoSprite — source video, positioned to implement crop
 *           └── windowBarSprite — the window bar, over the top of the page
 *
 * The shadow is rendered as a separate blurred shape behind videoContainer so
 * the recorded screen pixels do not pass through a filter render texture.
 */
import {
  Container,
  Graphics,
  Sprite,
  Texture,
  RenderTexture,
  BlurFilter,
  ColorMatrixFilter,
  CanvasSource,
  VideoSource,
} from 'pixi.js';
import type { PixiEffect, PixiEffectUpdater, PixiScene } from '../../pixi/types';
import { RECORDING_MASK_LABEL, RECORDING_VIDEO_SPRITE_LABEL } from '../../pixi/types';
import {
  SCREEN_VIDEO_MAG_FILTER,
  SCREEN_VIDEO_MIN_FILTER,
  SCREEN_VIDEO_MIPMAP_FILTER,
  SCREEN_VIDEO_SCALE_MODE,
  configureScreenVideoBridgeContext,
  createScreenVideoCanvasSource,
} from '../../pixi/textureQuality';
import type { RenderContext } from '../types';
import { useStore } from '../../../store';
import {
  sortMediaSegments,
  getEffectiveTransition,
  getEffectiveTransitionOut,
} from '../../helpers/segments';
import { NO_CLIP_TRANSITION } from '../../../types/timeline';
import { DEFAULT_CROP_RECT, getFrameGeometry, getFrameGeometryForPanel } from './analyze';
import { GRADIENT_PRESETS } from './presets';
import { resolveWallpaperPreset, getWallpaperImage } from './wallpapers';
import type { BackgroundSettings, CropRect, FrameSettings } from './index';
import { setClipTransitionAlpha } from './index';
import type { MediaSegment, ZoomClip } from '../../../types/timeline';
import type { FrameGeometry } from './analyze';
import { resolveCameraAtTime } from '../camera/layout';
import { interpolateCamera } from '../zoom/render';
import { WindowBarPainter, sampleTopBandBrightness } from './window-bar';
import { recordingPageVisits } from '../../recording/captureSource';
import { drawWindowBar } from '../../window-bar/canvas';

// ── Clip-boundary fade ────────────────────────────────────────────────────────

// Minimum black hold after a segment boundary so the new decoded frame has a
// chance to replace the previous texture before opacity rises.
export const CLIP_FADE_IN_HOLD = 0.06;
// Fixed alpha crossfade duration for non-fade transition types (slide/scale/blur).
// The user-controlled duration only governs the transform; the crossfade stays short.
const NON_FADE_ALPHA_DUR = 0.18;
// Duration for the screen-rect fade when a side-layout camera clip ends with no
// following clip (or a gap exists). Matches TRANSITION_HALF_S in camera/layout.ts.
const SCREEN_RECT_FADE_S = 0.4;

function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 2 * c * c : -1 + (4 - 2 * c) * c;
}

function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) ** 3;
}

function easeInCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * c;
}

// Fade-in is NOT computed here — the caller handles it with wall-clock time so
// video seeks of arbitrary length don't extend the black hold at boundaries.
export function computeFadeOutAlpha(
  timelineT: number,
  segments: ReturnType<typeof sortMediaSegments>,
): { alpha: number; segIdx: number } {
  // No clips (the last one was deleted): there is no segment to index.
  if (segments.length === 0) {
    return { alpha: 1, segIdx: -1 };
  }
  if (segments.length === 1) {
    return { alpha: 1, segIdx: 0 };
  }

  const idx = segments.findIndex((s) => timelineT >= s.timelineStart && timelineT < s.timelineEnd);
  if (idx < 0) {
    // When timelineT falls in a floating-point gap between segments (created by
    // ripple-delete shift arithmetic), keep black rather than flashing opaque.
    const first = segments[0];
    const last = segments[segments.length - 1];
    const alpha = timelineT > first.timelineStart && timelineT < last.timelineEnd ? 0 : 1;
    return { alpha, segIdx: -1 };
  }

  let alpha = 1;
  {
    // The current clip's transitionOut drives its own fade-out (including the last clip).
    // For fade/fade-white the user-controlled duration is used; for slide/scale/blur
    // a fixed short alpha crossfade is used so the user's duration only governs the transform.
    const transitionOut = getEffectiveTransitionOut(segments[idx]);
    if (transitionOut.type !== 'none') {
      const isFadeType = transitionOut.type === 'fade' || transitionOut.type === 'fade-white';
      const fadeOutAlphaDur = isFadeType ? transitionOut.duration : NON_FADE_ALPHA_DUR;
      const timeFromEnd = segments[idx].timelineEnd - timelineT;
      if (timeFromEnd < fadeOutAlphaDur) {
        alpha = Math.min(alpha, easeInOut(timeFromEnd / fadeOutAlphaDur));
      }
    }
  }

  return { alpha, segIdx: idx };
}

// ── Blur background helpers ───────────────────────────────────────────────────

const BLUR_SCALE = 0.25;

const BLUR_BG_UPDATE_INTERVAL = 1 / 15;

interface BlurBgState {
  renderTexture: RenderTexture;
  sourceSprite: Sprite;
  bgSprite: Sprite;
  blurFilter: BlurFilter;
  colorFilter: ColorMatrixFilter;
  lastIntensity: number;
  lastRenderTime: number;
}

function createBlurBgState(canvasWidth: number, canvasHeight: number): BlurBgState {
  const bw = Math.max(1, Math.round(canvasWidth * BLUR_SCALE));
  const bh = Math.max(1, Math.round(canvasHeight * BLUR_SCALE));
  const renderTexture = RenderTexture.create({ width: bw, height: bh });
  const sourceSprite = new Sprite();
  sourceSprite.width = bw;
  sourceSprite.height = bh;

  const blurFilter = new BlurFilter({ strength: 8, quality: 3 });
  const colorFilter = new ColorMatrixFilter();
  colorFilter.brightness(0.7, false);

  const bgSprite = new Sprite(renderTexture);
  bgSprite.width = canvasWidth + 8;
  bgSprite.height = canvasHeight + 8;
  bgSprite.x = -4;
  bgSprite.y = -4;
  bgSprite.filters = [blurFilter, colorFilter];

  return {
    renderTexture,
    sourceSprite,
    bgSprite,
    blurFilter,
    colorFilter,
    lastIntensity: -1,
    lastRenderTime: -1,
  };
}

function updateBlurBg(
  state: BlurBgState,
  scene: PixiScene,
  videoTexture: Texture | null,
  intensity: number,
  canvasWidth: number,
  canvasHeight: number,
  currentTime: number,
): void {
  if (!videoTexture) {
    return;
  }

  // Always update blur radius so changes to blurIntensity reflect immediately,
  // even when the render-to-texture pass is throttled below.
  if (state.lastIntensity !== intensity) {
    const bw = state.renderTexture.width;
    const bh = state.renderTexture.height;
    const radius = Math.round(Math.max(bw, bh) * 0.06 * Math.max(0.1, intensity));
    state.blurFilter.blur = radius;
    state.lastIntensity = intensity;
  }

  state.sourceSprite.texture = videoTexture;
  state.bgSprite.width = canvasWidth + 8;
  state.bgSprite.height = canvasHeight + 8;

  // Throttle the render-to-texture pass to ~15fps. The heavily blurred output
  // changes imperceptibly between adjacent frames, saving 2 GPU passes per frame.
  // BlurFilter and ColorMatrixFilter are still applied every frame by PixiJS
  // when rendering bgSprite, so intensity/color changes remain instant.
  if (Math.abs(currentTime - state.lastRenderTime) < BLUR_BG_UPDATE_INTERVAL) {
    return;
  }

  scene.app.renderer.render({
    container: state.sourceSprite,
    target: state.renderTexture,
    clear: true,
  });
  state.lastRenderTime = currentTime;
}

// ── Gradient helpers ──────────────────────────────────────────────────────────

/** Renders a gradient to a 4×4 canvas (PixiJS upscales it) for use as a texture. */
function createGradientTexture(
  settings: BackgroundSettings,
  canvasWidth: number,
  canvasHeight: number,
): Texture {
  // Use an OffscreenCanvas so gradient math can use the full Canvas 2D API.
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;

  let angle: number;
  let stops: Array<{ offset: number; color: string }>;

  if (settings.gradientPresetId === 'custom') {
    angle = settings.gradientAngle;
    stops = [
      { offset: 0, color: settings.gradientFrom },
      { offset: 1, color: settings.gradientTo },
    ];
  } else {
    const preset =
      GRADIENT_PRESETS.find((p) => p.id === settings.gradientPresetId) ?? GRADIENT_PRESETS[0];
    angle = preset.angle;
    stops = preset.stops;
  }

  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const len = Math.sqrt(canvasWidth * canvasWidth + canvasHeight * canvasHeight) / 2;
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  const gradient = ctx.createLinearGradient(
    cx - cos * len,
    cy - sin * len,
    cx + cos * len,
    cy + sin * len,
  );
  for (const stop of stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  return Texture.from(canvas as unknown as HTMLCanvasElement);
}

/** Loads wallpaper textures keyed by URL — cached across frames. */
const wallpaperTextureCache = new Map<string, Texture>();

function getWallpaperTexture(url: string): Texture | null {
  const cached = wallpaperTextureCache.get(url);
  if (cached) {
    return cached;
  }
  // Use HTMLImageElement (from the shared wallpaper cache) so Pixi creates a
  // real ImageSource. Texture.from(string) only does a cache lookup in v8 and
  // returns undefined if the asset was never loaded in this JS context — which
  // always happens in the export worker window, causing "Cannot read properties
  // of undefined (reading 'width')" in KawaseBlurFilter.apply().
  const img = getWallpaperImage(url);
  if (!img.complete || img.naturalWidth === 0) {
    return null; // not yet loaded — caller will retry next frame
  }
  const texture = Texture.from(img as unknown as HTMLImageElement);
  wallpaperTextureCache.set(url, texture);
  return texture;
}

// ── Background helpers ────────────────────────────────────────────────────────

function buildGradientKey(s: BackgroundSettings): string {
  return `${s.gradientPresetId}|${s.gradientFrom}|${s.gradientTo}|${s.gradientAngle}`;
}

function isHTMLVideoSource(source: CanvasImageSource): source is HTMLVideoElement {
  return typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
}

/**
 * Whether the screen video can go to the GPU whole. Only an uncropped preview
 * video can: its mip chain is built from everything uploaded, so with a crop
 * the levels would blend pixels from outside it into its edges, and the media
 * mask cannot take them back out. Everything else copies just the crop.
 */
export function uploadsWholeVideo(
  source: CanvasImageSource,
  crop: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
): source is HTMLVideoElement {
  return (
    isHTMLVideoSource(source) &&
    crop.x === 0 &&
    crop.y === 0 &&
    crop.width === sourceWidth &&
    crop.height === sourceHeight
  );
}

// ── Frame effect ──────────────────────────────────────────────────────────────

export const framePixiEffect: PixiEffect<null> = {
  id: 'frame',
  analyze: () => null,

  setup(_data, _allData, scene): PixiEffectUpdater {
    const canvasWidth = scene.app.renderer.width;
    const canvasHeight = scene.app.renderer.height;

    // ── Video sprite ────────────────────────────────────────────────────────
    const videoSprite = new Sprite();
    videoSprite.eventMode = 'none';
    videoSprite.roundPixels = false;
    // The cursor's magnifier finds the recording by this label.
    videoSprite.label = RECORDING_VIDEO_SPRITE_LABEL;

    // ── Media container (masked to mediaRect with rounded corners) ──────────
    const mediaContainer = new Container();
    const mediaMask = new Graphics();
    // The cursor magnifier clips to this too, so it never shows cropped-out pixels.
    mediaMask.label = RECORDING_MASK_LABEL;
    mediaContainer.mask = mediaMask;

    // ── Window bar ──────────────────────────────────────────────────────────
    // Drawn as vectors onto its own canvas at the size it shows on screen
    // (zoom included), so it is never an upscaled bitmap, then uploaded only
    // when its pixels change (a page change crossfade, a zoom step).
    const windowBar = new WindowBarPainter();
    const windowBarCanvas = document.createElement('canvas');
    windowBarCanvas.width = 1;
    windowBarCanvas.height = 1;
    const windowBarCtx = windowBarCanvas.getContext('2d');
    let windowBarSource: CanvasSource | null = null;
    const windowBarSprite = new Sprite();
    windowBarSprite.eventMode = 'none';
    windowBarSprite.visible = false;
    let lastWindowBarKey = '';
    // A web font that finishes loading after the first draw must redraw the bar.
    let fontsLoaded = 0;
    const onFontsLoaded = (): void => {
      fontsLoaded++;
    };
    if (typeof document !== 'undefined' && document.fonts) {
      document.fonts.addEventListener('loadingdone', onFontsLoaded);
    }

    mediaContainer.addChild(videoSprite, windowBarSprite, mediaMask);

    // ── Background repaint inside media rect ───────────────────────────────
    // Background redrawn only within mediaRect (not the full contentRect) so the
    // letterbox area between mediaRect and contentRect shows the shadow glow from
    // backgroundContainer rather than being blanketed by an opaque repaint.
    const bgRepaintContainer = new Container();
    const bgRepaintMask = new Graphics();
    bgRepaintContainer.mask = bgRepaintMask;

    const bgRepaintSolid = new Graphics();
    const bgRepaintGradient = new Sprite();
    const bgRepaintWallpaper = new Sprite();
    const bgRepaintBlur = new Sprite(); // shared RenderTexture with main bg
    bgRepaintContainer.addChild(
      bgRepaintSolid,
      bgRepaintGradient,
      bgRepaintWallpaper,
      bgRepaintBlur,
      bgRepaintMask, // must be in the scene graph for masking to work
    );

    // ── Content mask + video container ──────────────────────────────────────
    const contentMask = new Graphics();
    scene.videoContainer.mask = contentMask;
    scene.videoContainer.addChild(contentMask, bgRepaintContainer, mediaContainer);

    // ── Full-canvas background (behind cameraContainer content) ─────────────
    const bgSolid = new Graphics();
    const bgGradient = new Sprite();
    const bgWallpaper = new Sprite();
    scene.backgroundContainer.addChild(bgSolid, bgGradient, bgWallpaper);

    // Blur state shared between main bg and repaint sprite.
    const blurState = createBlurBgState(canvasWidth, canvasHeight);
    scene.backgroundContainer.addChild(blurState.bgSprite);

    // ── Shadow shape ────────────────────────────────────────────────────────
    // Keep the shadow outside videoContainer so the recorded screen pixels never
    // pass through its mask, while still grouping it with the preview surface for
    // cinematic tilt.
    const shadowShape = new Graphics();
    const shadowBlurFilter = new BlurFilter({ strength: 0, quality: 3 });
    scene.frameContainer.addChildAt(shadowShape, 0);

    // ── Track last settings for change detection ─────────────────────────────
    let lastGradientKey = '';
    let lastSolidColor = '';
    let lastWallpaperSeed = NaN;
    let lastShadowKey = '';
    let lastMediaMaskKey = '';
    let lastContentMaskKey = '';
    let baseShadowX = 0;
    let baseShadowY = 0;
    let baseShadowOpacity = 0;

    // ── Geometry cache ────────────────────────────────────────────────────────
    // getFrameGeometry is called every frame. Cache the result and only recompute
    // when the frame object reference, source dimensions, or crop freeze state change.
    // Zustand always creates new object references on mutation so reference equality
    // is a reliable change indicator.
    let lastGeomFrame: FrameSettings | null = null;
    let lastGeomSW = -1;
    let lastGeomSH = -1;
    let lastGeomCropKey = '';
    let cachedGeom: FrameGeometry | null = null;

    // ── Media-segments sort cache ─────────────────────────────────────────────
    // sortMediaSegments creates a new array on every call. Cache it behind a
    // reference-equality check — Zustand creates new array references on mutation.
    let lastMediaSegmentsRef: MediaSegment[] | null = null;
    let cachedSortedSegs: ReturnType<typeof sortMediaSegments> = [];

    // ── Video bridge canvas (CPU bridge: drawImage → CanvasSource → GPU) ─────
    // Using a regular HTMLCanvasElement as an intermediary avoids OffscreenCanvas
    // WebGL upload issues and VideoSource Ticker dependency in PixiJS v8.
    const videoBridgeCanvas = document.createElement('canvas');
    const videoBridgeCtx = videoBridgeCanvas.getContext('2d');
    if (!videoBridgeCtx) {
      console.error('[FrameEffect] Failed to get 2D context for video bridge canvas');
    }
    configureScreenVideoBridgeContext(videoBridgeCtx);
    let videoBridgeSource: CanvasSource | null = null;
    let videoElementSource: VideoSource | null = null;
    let videoElementSourceElement: HTMLVideoElement | null = null;
    let videoElementTexture: Texture | null = null;
    let videoBridgeTexture: Texture | null = null;
    let currentVideoTexture: Texture | null = null;
    // True when the texture holds only the crop (the bridge canvas), so the
    // sprite fills the media rect instead of being offset behind its mask.
    let videoTextureIsCrop = false;

    // ── Renderer size tracking — reset change-detection guards on resize ──────
    let lastCw = -1;
    let lastCh = -1;
    let lastGcw = -1;
    let lastGch = -1;

    // ── Crop freeze during editing ────────────────────────────────────────────
    // Prevent the video sprite from zooming/panning on every pointermove while
    // the user is adjusting the crop overlay. Thaw on editing end.
    let frozenCropRect: CropRect | null = null;
    let wasCropEditing = false;

    // ── Fade-in state (wall-clock, preview-only) ─────────────────────────────
    // Keyed to segment entry time rather than video.readyState so long preview
    // seeks do not stretch the black hold after a ripple-delete boundary.
    let fadeInWallStart: number | null = null;
    let lastKnownSegIdx = -1;
    // Cached BlurFilters for transitions — reused across frames to avoid GPU resource churn.
    let transitionBlurFilter: BlurFilter | null = null;
    let transitionOutBlurFilter: BlurFilter | null = null;

    // ── Export-mode transition diagnostics ───────────────────────────────────
    let exportLastLoggedSegIdx = -2;
    let exportFadeOutLoggedForSeg = -2;
    let exportFadeInLoggedForSeg = -2;

    // ── Fade-white overlay ────────────────────────────────────────────────────
    // Sits in frameContainer behind videoContainer so
    // it shows through the fading videoContainer during fade-white transitions,
    // while the actual background stays static and untilted.
    const transitionWhiteOverlay = new Graphics();
    transitionWhiteOverlay.visible = false;
    scene.frameContainer.addChildAt(
      transitionWhiteOverlay,
      scene.frameContainer.getChildIndex(scene.videoContainer),
    );
    let lastOverlayKey = '';

    // ── Screen-rect fade state ────────────────────────────────────────────────
    // Smooths the expansion back to full canvas when a side-layout (left/right)
    // camera clip ends with no following clip or when there's a gap between clips.
    // Stores the full panel FrameGeometry (not just the screenRect) so we can
    // interpolate contentRect/mediaRect directly toward cachedGeom — avoiding a
    // snap at fade end where camera fixedPadding ≠ frame.background.padding.
    let lastPanelGeom: FrameGeometry | null = null;
    let screenRectFadeElapsed = 0;

    // ── Updater ──────────────────────────────────────────────────────────────
    return (t, dt, renderContext: RenderContext) => {
      const renderState = useStore.getState();
      // Single getState() call — reading all required fields at once avoids
      // redundant Zustand store accesses inside a hot 60fps path.
      const {
        frame,
        isCropEditing,
        currentTime,
        mediaSegments,
        hiddenLayers,
        camera,
        cameraClips,
        zoomClips,
      } = renderState;

      // Freeze to the full source during editing so the Pixi canvas matches the
      // overlay (which always positions itself against the full source). Using
      // the existing frame.cropRect would show the already-cropped view, which
      // misaligns with the overlay's DEFAULT_CROP_RECT-based geometry.
      if (isCropEditing && !wasCropEditing) {
        frozenCropRect = DEFAULT_CROP_RECT;
      } else if (!isCropEditing) {
        frozenCropRect = null;
      }
      wasCropEditing = isCropEditing;
      const effectiveFrame =
        frozenCropRect !== null ? { ...frame, cropRect: frozenCropRect } : frame;

      const { background } = effectiveFrame;
      const { cornerRadius, shadowBlur, shadowOpacity, type: bgType } = background;

      const cw = scene.app.renderer.width;
      const ch = scene.app.renderer.height;

      // Recompute geometry only when the frame, crop key, or source dimensions change.
      // getFrameGeometry() is otherwise called every frame at 60fps with identical inputs.
      const cropKey =
        frozenCropRect !== null
          ? `${frozenCropRect.x}|${frozenCropRect.y}|${frozenCropRect.width}|${frozenCropRect.height}`
          : 'none';
      if (
        frame !== lastGeomFrame ||
        scene.sourceWidth !== lastGeomSW ||
        scene.sourceHeight !== lastGeomSH ||
        cropKey !== lastGeomCropKey
      ) {
        cachedGeom = getFrameGeometry(effectiveFrame, scene.sourceWidth, scene.sourceHeight);
        lastGeomFrame = frame;
        lastGeomSW = scene.sourceWidth;
        lastGeomSH = scene.sourceHeight;
        lastGeomCropKey = cropKey;
      }
      if (!cachedGeom) {
        return;
      }
      const geometry = cachedGeom;

      // Compute panel-adjusted geometry when camera is in a side layout. The recording
      // renders within its panel (right for 'left' camera, left for 'right' camera) instead
      // of the full canvas, so the video is never squished and cursor coordinates stay correct.
      const isPreviewMode = renderContext.videoSource?.source instanceof HTMLVideoElement;
      const timelineT = isPreviewMode ? currentTime : (renderContext.outputTime ?? t);
      let contentGeom: FrameGeometry = cachedGeom;
      if (camera.enabled) {
        const zoomScale = interpolateCamera(zoomClips as ZoomClip[], timelineT)?.scale ?? 1;
        const cameraResolved = resolveCameraAtTime(
          cameraClips,
          timelineT,
          camera,
          cw,
          ch,
          zoomScale,
        );
        const sr = cameraResolved?.screenRect ?? null;

        // Smooth the recording panel expanding back to full canvas when a side-layout
        // clip ends with no following clip or a gap exists between clips.
        // Interpolate contentRect/mediaRect directly toward cachedGeom so the fade
        // lands exactly on cachedGeom — no snap where camera inset ≠ frame padding.
        if (sr !== null) {
          const insetPx = camera.fixedPadding * (Math.min(cw, ch) / 1080);
          lastPanelGeom = getFrameGeometryForPanel(
            effectiveFrame,
            scene.sourceWidth,
            scene.sourceHeight,
            sr.x,
            sr.y,
            sr.width,
            sr.height,
            insetPx,
          );
          screenRectFadeElapsed = 0;
          contentGeom = lastPanelGeom;
        } else if (lastPanelGeom !== null) {
          screenRectFadeElapsed = Math.min(screenRectFadeElapsed + dt, SCREEN_RECT_FADE_S);
          const fadeAlpha = easeInOut(screenRectFadeElapsed / SCREEN_RECT_FADE_S);
          if (fadeAlpha < 1) {
            const fromCR = lastPanelGeom.contentRect;
            const toCR = cachedGeom.contentRect;
            const fromMR = lastPanelGeom.mediaRect;
            const toMR = cachedGeom.mediaRect;
            const fromWR = lastPanelGeom.windowRect;
            const toWR = cachedGeom.windowRect;
            contentGeom = {
              ...cachedGeom,
              contentRect: {
                x: fromCR.x + (toCR.x - fromCR.x) * fadeAlpha,
                y: fromCR.y + (toCR.y - fromCR.y) * fadeAlpha,
                width: fromCR.width + (toCR.width - fromCR.width) * fadeAlpha,
                height: fromCR.height + (toCR.height - fromCR.height) * fadeAlpha,
              },
              mediaRect: {
                x: fromMR.x + (toMR.x - fromMR.x) * fadeAlpha,
                y: fromMR.y + (toMR.y - fromMR.y) * fadeAlpha,
                width: fromMR.width + (toMR.width - fromMR.width) * fadeAlpha,
                height: fromMR.height + (toMR.height - fromMR.height) * fadeAlpha,
              },
              windowRect: {
                x: fromWR.x + (toWR.x - fromWR.x) * fadeAlpha,
                y: fromWR.y + (toWR.y - fromWR.y) * fadeAlpha,
                width: fromWR.width + (toWR.width - fromWR.width) * fadeAlpha,
                height: fromWR.height + (toWR.height - fromWR.height) * fadeAlpha,
              },
              barHeight:
                lastPanelGeom.barHeight +
                (cachedGeom.barHeight - lastPanelGeom.barHeight) * fadeAlpha,
            };
          } else {
            lastPanelGeom = null;
          }
        }
      } else {
        lastPanelGeom = null;
        screenRectFadeElapsed = 0;
      }
      const { contentRect, cropRectPixels, mediaRect, windowRect } = contentGeom;

      // For background rendering, use the frame geometry's canvas dimensions, NOT the
      // renderer dimensions. During export the renderer is sized to the standard encoder
      // resolution (e.g. 1920×1080) while the stage is shifted by contentOffsetX to
      // center non-16:9 content. Using renderer dims here causes the background to
      // overshoot the right edge of the stage content area, leaving a black bar only
      // on the left instead of equal bars on both sides.
      const gcw = geometry.canvasWidth;
      const gch = geometry.canvasHeight;

      // Reset change-detection guards when renderer or geometry canvas dims change so
      // backgrounds are redrawn at the new dimensions.
      if (cw !== lastCw || ch !== lastCh || gcw !== lastGcw || gch !== lastGch) {
        lastCw = cw;
        lastCh = ch;
        lastGcw = gcw;
        lastGch = gch;
        lastGradientKey = '';
        lastSolidColor = '';
        lastWallpaperSeed = NaN;
        lastShadowKey = '';
        lastMediaMaskKey = '';
        lastContentMaskKey = '';
      }

      const scaledRadius = cornerRadius * (ch / 1080);
      const contentRadius = Math.max(
        0,
        Math.min(scaledRadius, contentRect.width / 2, contentRect.height / 2),
      );
      // Radius and shadow wrap the whole window (bar + page); windowRect is
      // mediaRect itself when there is no bar.
      const mediaRadius = Math.max(
        0,
        Math.min(scaledRadius, windowRect.width / 2, windowRect.height / 2),
      );

      // ── Update video texture from renderContext ──────────────────────────
      // An uncropped preview uses the HTMLVideoElement directly. Everything else
      // (export, and a cropped preview) goes through a 1:1 bridge canvas so the
      // copy stays unsmoothed before GPU upload. The bridge copies only the
      // crop's exact pixels: scaling a full-source texture behind the media mask
      // let the GPU blend in pixels from just outside the crop along its edges
      // (and shifted it by a fraction of a pixel), and the mip chain built from
      // a full-source upload does the same; an area recording must show neither.
      const videoSrc = renderContext.videoSource;
      if (videoSrc?.ready && videoSrc.source && videoSrc.width > 0 && videoSrc.height > 0) {
        const srcW = videoSrc.width;
        const srcH = videoSrc.height;
        const crop = getFrameGeometry(effectiveFrame, srcW, srcH).cropRectPixels;
        if (uploadsWholeVideo(videoSrc.source, crop, srcW, srcH)) {
          videoTextureIsCrop = false;
          if (videoElementSourceElement !== videoSrc.source) {
            videoElementSource = new VideoSource({
              resource: videoSrc.source,
              autoLoad: false,
              autoPlay: false,
              width: srcW,
              height: srcH,
              resolution: 1,
              scaleMode: SCREEN_VIDEO_SCALE_MODE,
              magFilter: SCREEN_VIDEO_MAG_FILTER,
              minFilter: SCREEN_VIDEO_MIN_FILTER,
              mipmapFilter: SCREEN_VIDEO_MIPMAP_FILTER,
              // As in export: a Retina recording is shown smaller than it is, and without a
              // mip chain small text and UI edges shimmer and step.
              autoGenerateMipmaps: true,
            });
            videoElementSource.autoUpdate = false;
            videoElementSourceElement = videoSrc.source;
            videoElementTexture = new Texture({ source: videoElementSource });
          }
          // Set every frame: cropping and uncropping switch between this and
          // the bridge texture without either being rebuilt.
          currentVideoTexture = videoElementTexture;
          if (currentVideoTexture) {
            videoSprite.texture = currentVideoTexture;
          }
          videoElementSource?.update();
        } else if (videoBridgeCtx) {
          if (videoBridgeCanvas.width !== crop.width || videoBridgeCanvas.height !== crop.height) {
            videoBridgeCanvas.width = crop.width;
            videoBridgeCanvas.height = crop.height;
            configureScreenVideoBridgeContext(videoBridgeCtx);
            // A new size needs a new GPU source; the old one keeps the old size.
            videoBridgeSource?.destroy();
            videoBridgeSource = null;
          }
          videoBridgeCtx.drawImage(
            videoSrc.source as CanvasImageSource,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            0,
            0,
            crop.width,
            crop.height,
          );
          if (!videoBridgeSource) {
            videoBridgeSource = createScreenVideoCanvasSource(videoBridgeCanvas);
            videoBridgeTexture = new Texture({ source: videoBridgeSource });
          }
          currentVideoTexture = videoBridgeTexture;
          if (currentVideoTexture) {
            videoSprite.texture = currentVideoTexture;
          }
          videoBridgeSource.update();
          videoTextureIsCrop = true;
        }
      }

      // ── Clip-boundary fade ───────────────────────────────────────────────
      // isPreviewMode and timelineT are computed earlier (for panel geometry) and reused here.

      // Cache the sorted segments — sortMediaSegments allocates a new array on every
      // call. Recompute only when the mediaSegments reference changes (Zustand always
      // produces a new reference on mutation).
      if (mediaSegments !== lastMediaSegmentsRef) {
        cachedSortedSegs = sortMediaSegments(mediaSegments);
        lastMediaSegmentsRef = mediaSegments;
      }
      const sortedSegs = cachedSortedSegs;
      const { alpha: fadeOutAlpha, segIdx } = computeFadeOutAlpha(timelineT, sortedSegs);
      const wallNow = performance.now();

      let stageAlpha = fadeOutAlpha;

      // Fade-in progress (0 = fully hidden, 1 = fully visible) — used for transform timing.
      let fadeInProgress = 1;

      const currentTransition =
        segIdx >= 0 ? getEffectiveTransition(sortedSegs[segIdx]) : NO_CLIP_TRANSITION;
      const fadeDur = currentTransition.type === 'none' ? 0 : currentTransition.duration;
      // For fade/fade-white: alpha duration = user-controlled fadeDur.
      // For slide/scale/blur: alpha duration = fixed NON_FADE_ALPHA_DUR; transform
      // duration = user-controlled fadeDur. The two are independent so changing
      // duration only stretches the transform, not the crossfade.
      const isFadeType =
        currentTransition.type === 'fade' || currentTransition.type === 'fade-white';
      const alphaInDur = isFadeType ? fadeDur : NON_FADE_ALPHA_DUR;

      if (segIdx >= 0 && isPreviewMode && segIdx > 0) {
        // Segments 2+: use wall-clock time so the fade-in starts the moment the
        // segment becomes active, not waiting for the HTMLVideoElement to finish
        // seeking (which can take hundreds of ms after a boundary crossing).
        if (segIdx !== lastKnownSegIdx) {
          // Entering a new segment — decide once whether a hold is needed.
          // A hold is required when:
          //   a) the incoming clip has a fade-in transition (fadeDur > 0), OR
          //   b) the outgoing clip had a transitionOut — without a hold, stageAlpha
          //      jumps 0→1 while the video texture still shows the previous frame.
          const prevHadTransitionOut =
            lastKnownSegIdx >= 0 &&
            lastKnownSegIdx < sortedSegs.length &&
            getEffectiveTransitionOut(sortedSegs[lastKnownSegIdx]).type !== 'none';
          if (fadeDur > 0 || prevHadTransitionOut) {
            fadeInWallStart = wallNow;
          } else {
            fadeInWallStart = null;
          }
          const incomingSeg = sortedSegs[segIdx];
          const outgoingSeg = lastKnownSegIdx >= 0 ? sortedSegs[lastKnownSegIdx] : null;
          window.screenforge.writeDiagnosticLog('frame-pixi.segment-enter', {
            segIdx,
            lastKnownSegIdx,
            timelineT: Math.round(timelineT * 1000) / 1000,
            fadeDur,
            prevHadTransitionOut,
            holdStarted: fadeInWallStart !== null,
            incomingTransitionIn: incomingSeg?.transitionIn ?? 'undefined(→default-fade)',
            outgoingTransitionOut: outgoingSeg
              ? (outgoingSeg.transitionOut ?? 'undefined(→none)')
              : 'n/a',
          });
        }

        if (fadeInWallStart !== null) {
          const elapsed = (wallNow - fadeInWallStart) / 1000;
          // Also hold while the video is seeking — a long source-position jump
          // (e.g. record-more clip placed mid-timeline) can take hundreds of ms,
          // far exceeding CLIP_FADE_IN_HOLD, so we must wait for seeking to finish
          // before revealing the new frame.
          const videoEl =
            renderContext.videoSource?.source instanceof HTMLVideoElement
              ? renderContext.videoSource.source
              : null;
          const isSeeking = videoEl?.seeking === true;
          if (elapsed < CLIP_FADE_IN_HOLD || isSeeking) {
            stageAlpha = 0;
            fadeInProgress = 0;
          } else if (fadeDur > 0) {
            const t = elapsed - CLIP_FADE_IN_HOLD;
            if (t < alphaInDur) {
              stageAlpha = Math.min(stageAlpha, easeInOut(t / alphaInDur));
            }
            if (t < fadeDur) {
              fadeInProgress = easeOutCubic(t / fadeDur);
            }
          }
        } else if (fadeOutAlpha > 0.01) {
          // fadeInWallStart is null (no hold) and stageAlpha is non-zero — this is
          // the instant-cut path. Log it once per segment entry to confirm no flash.
          if (segIdx !== lastKnownSegIdx) {
            window.screenforge.writeDiagnosticLog('frame-pixi.instant-cut', {
              segIdx,
              stageAlpha: Math.round(fadeOutAlpha * 100) / 100,
              timelineT: Math.round(timelineT * 1000) / 1000,
            });
          }
        }
      } else if (segIdx >= 0 && fadeDur > 0) {
        // First clip (preview) and all export frames: use timeline time.
        // The first clip has no seek delay, so wall-clock time would race past
        // the transition before the user even presses play.
        const timeInSeg = timelineT - sortedSegs[segIdx].timelineStart;

        // ── Export transition diagnostics: log on first frame of each segment ──
        if (!isPreviewMode && segIdx !== exportLastLoggedSegIdx) {
          exportLastLoggedSegIdx = segIdx;
          window.screenforge.writeDiagnosticLog('export.transition.seg-enter', {
            segIdx,
            outputTime: Math.round((renderContext.outputTime ?? t) * 1000) / 1000,
            sourceTime: Math.round(t * 1000) / 1000,
            timelineT: Math.round(timelineT * 1000) / 1000,
            timeInSeg: Math.round(timeInSeg * 1000) / 1000,
            fadeDur,
            alphaInDur,
            segs: sortedSegs.map((s) => ({
              tStart: Math.round(s.timelineStart * 1000) / 1000,
              tEnd: Math.round(s.timelineEnd * 1000) / 1000,
              speed: s.speed ?? 1,
              trIn: s.transitionIn?.type ?? 'default',
              trOut: s.transitionOut?.type ?? 'none',
            })),
          });
        }

        if (timeInSeg < CLIP_FADE_IN_HOLD) {
          stageAlpha = 0;
          fadeInProgress = 0;
        } else {
          const tFade = timeInSeg - CLIP_FADE_IN_HOLD;
          // ── Log first frame where fade-in actually starts ───────────────
          if (!isPreviewMode && exportFadeInLoggedForSeg !== segIdx) {
            exportFadeInLoggedForSeg = segIdx;
            window.screenforge.writeDiagnosticLog('export.transition.fade-in-start', {
              segIdx,
              outputTime: Math.round((renderContext.outputTime ?? t) * 1000) / 1000,
              timeInSeg: Math.round(timeInSeg * 1000) / 1000,
              tFade: Math.round(tFade * 1000) / 1000,
              alphaInDur,
              fadeDur,
            });
          }
          if (tFade < alphaInDur) {
            stageAlpha = Math.min(stageAlpha, easeInOut(tFade / alphaInDur));
          }
          if (tFade < fadeDur) {
            fadeInProgress = easeOutCubic(tFade / fadeDur);
          }
        }
      }

      if (segIdx >= 0) {
        lastKnownSegIdx = segIdx;
      }

      // ── Transition out progress ───────────────────────────────────────────
      // Driven by the current segment's own transitionOut. Uses timeline time
      // directly (no hold needed — the clip is still playing, not seeking).
      let fadeOutProgress = 0;
      const currentTransitionOut =
        segIdx >= 0
          ? getEffectiveTransitionOut(sortedSegs[segIdx])
          : { type: 'none' as const, duration: 0 };
      const fadeOutDur = currentTransitionOut.type === 'none' ? 0 : currentTransitionOut.duration;

      if (segIdx >= 0 && fadeOutDur > 0) {
        const timeFromEnd = sortedSegs[segIdx].timelineEnd - timelineT;
        if (timeFromEnd < fadeOutDur) {
          fadeOutProgress = easeInCubic(1 - timeFromEnd / fadeOutDur);
          // ── Log first frame where fade-out starts ──────────────────────
          if (!isPreviewMode && exportFadeOutLoggedForSeg !== segIdx) {
            exportFadeOutLoggedForSeg = segIdx;
            window.screenforge.writeDiagnosticLog('export.transition.fade-out-start', {
              segIdx,
              outputTime: Math.round((renderContext.outputTime ?? t) * 1000) / 1000,
              timelineT: Math.round(timelineT * 1000) / 1000,
              timelineEnd: Math.round(sortedSegs[segIdx].timelineEnd * 1000) / 1000,
              timeFromEnd: Math.round(timeFromEnd * 1000) / 1000,
              fadeOutDur,
              fadeOutProgress: Math.round(fadeOutProgress * 100) / 100,
            });
          }
        }
      }

      // Reset videoContainer transforms each frame before applying transition overrides.
      // Transitions are scoped to videoContainer so the background stays static.
      scene.videoContainer.x = 0;
      scene.videoContainer.y = 0;
      scene.videoContainer.scale.set(1);
      scene.videoContainer.pivot.set(0);
      scene.videoContainer.filters = null;

      // fade-white overlay: white rect behind the fading videoContainer so white
      // shows through during fade-white transitions (both in and out).
      const isFadeWhiteIn =
        segIdx >= 0 && currentTransition.type === 'fade-white' && stageAlpha < 1;
      const isFadeWhiteOut =
        segIdx >= 0 && currentTransitionOut.type === 'fade-white' && fadeOutProgress > 0;
      if (isFadeWhiteIn || isFadeWhiteOut) {
        transitionWhiteOverlay.visible = true;
        const overlayKey = `${contentRect.x}|${contentRect.y}|${contentRect.width}|${contentRect.height}|${contentRadius}`;
        if (overlayKey !== lastOverlayKey) {
          transitionWhiteOverlay.clear();
          transitionWhiteOverlay
            .roundRect(
              contentRect.x,
              contentRect.y,
              contentRect.width,
              contentRect.height,
              contentRadius,
            )
            .fill(0xffffff);
          lastOverlayKey = overlayKey;
        }
      } else {
        transitionWhiteOverlay.visible = false;
      }

      // ── Transition-in transforms (incoming clip, fadeInProgress 0→1) ──────
      if (segIdx >= 0 && fadeInProgress < 1 && currentTransition.type !== 'none') {
        const inv = 1 - fadeInProgress;
        const vcx = contentRect.x + contentRect.width / 2;
        const vcy = contentRect.y + contentRect.height / 2;

        switch (currentTransition.type) {
          case 'slide-up':
            scene.videoContainer.y = ch * inv * 0.4;
            break;
          case 'slide-down':
            scene.videoContainer.y = -ch * inv * 0.4;
            break;
          case 'slide-left':
            scene.videoContainer.x = cw * inv * 0.4;
            break;
          case 'slide-right':
            scene.videoContainer.x = -cw * inv * 0.4;
            break;
          case 'grow': {
            const s = 0.75 + 0.25 * fadeInProgress;
            scene.videoContainer.pivot.set(vcx, vcy);
            scene.videoContainer.position.set(vcx, vcy);
            scene.videoContainer.scale.set(s);
            break;
          }
          case 'shrink': {
            const s = 1.25 - 0.25 * fadeInProgress;
            scene.videoContainer.pivot.set(vcx, vcy);
            scene.videoContainer.position.set(vcx, vcy);
            scene.videoContainer.scale.set(s);
            break;
          }
          case 'blur': {
            if (!transitionBlurFilter) {
              transitionBlurFilter = new BlurFilter({ strength: 0, quality: 2 });
            }
            transitionBlurFilter.strength = inv * 24;
            scene.videoContainer.filters = inv > 0.02 ? [transitionBlurFilter] : null;
            break;
          }
          default:
            break;
        }
      }

      // ── Transition-out transforms (outgoing clip, fadeOutProgress 0→1) ────
      if (fadeOutProgress > 0 && currentTransitionOut.type !== 'none') {
        const vcx = contentRect.x + contentRect.width / 2;
        const vcy = contentRect.y + contentRect.height / 2;

        switch (currentTransitionOut.type) {
          case 'slide-up':
            scene.videoContainer.y -= ch * fadeOutProgress * 0.4;
            break;
          case 'slide-down':
            scene.videoContainer.y += ch * fadeOutProgress * 0.4;
            break;
          case 'slide-left':
            scene.videoContainer.x -= cw * fadeOutProgress * 0.4;
            break;
          case 'slide-right':
            scene.videoContainer.x += cw * fadeOutProgress * 0.4;
            break;
          case 'grow': {
            const s = 1 + 0.25 * fadeOutProgress;
            scene.videoContainer.pivot.set(vcx, vcy);
            scene.videoContainer.position.set(vcx, vcy);
            scene.videoContainer.scale.set(s);
            break;
          }
          case 'shrink': {
            const s = Math.max(0.01, 1 - 0.25 * fadeOutProgress);
            scene.videoContainer.pivot.set(vcx, vcy);
            scene.videoContainer.position.set(vcx, vcy);
            scene.videoContainer.scale.set(s);
            break;
          }
          case 'blur': {
            if (!transitionOutBlurFilter) {
              transitionOutBlurFilter = new BlurFilter({ strength: 0, quality: 2 });
            }
            transitionOutBlurFilter.strength = fadeOutProgress * 24;
            scene.videoContainer.filters =
              fadeOutProgress > 0.02 ? [transitionOutBlurFilter] : scene.videoContainer.filters;
            break;
          }
          default:
            break;
        }
      }

      const finalAlpha = Math.max(0, Math.min(1, stageAlpha));
      scene.videoContainer.alpha = finalAlpha;
      setClipTransitionAlpha(finalAlpha);

      // ── Export: sample alpha every 5th frame inside any transition window ──
      if (!isPreviewMode && segIdx >= 0) {
        const seg = sortedSegs[segIdx];
        const tEnd = seg.timelineEnd;
        const tStart = seg.timelineStart;
        const inFadeOut = fadeOutDur > 0 && tEnd - timelineT < fadeOutDur + 0.05;
        const inFadeIn = fadeDur > 0 && timelineT - tStart < CLIP_FADE_IN_HOLD + fadeDur + 0.05;
        if (inFadeOut || inFadeIn) {
          const frameNo = Math.round((renderContext.outputTime ?? t) * 60);
          if (frameNo % 5 === 0) {
            window.screenforge.writeDiagnosticLog('export.transition.alpha-sample', {
              segIdx,
              outputTime: Math.round((renderContext.outputTime ?? t) * 1000) / 1000,
              timelineT: Math.round(timelineT * 1000) / 1000,
              alpha: Math.round(finalAlpha * 1000) / 1000,
              fadeOutProgress: Math.round(fadeOutProgress * 1000) / 1000,
              fadeInProgress: Math.round(fadeInProgress * 1000) / 1000,
              inFadeOut,
              inFadeIn,
            });
          }
        }
      }

      // Sync shadow position and alpha to match videoContainer during transitions
      // so the blurred shadow doesn't linger at the original position when the
      // video slides/scales/fades.
      if (shadowShape.visible) {
        shadowShape.alpha = scene.videoContainer.alpha * baseShadowOpacity;
        shadowShape.pivot.copyFrom(scene.videoContainer.pivot);
        shadowShape.scale.copyFrom(scene.videoContainer.scale);
        shadowShape.position.set(
          scene.videoContainer.position.x + baseShadowX,
          scene.videoContainer.position.y + baseShadowY,
        );
      }

      // ── Video sprite: crop + scale to mediaRect ──────────────────────────
      const videoHidden = hiddenLayers.video;
      videoSprite.visible = !videoHidden;
      if (currentVideoTexture && !videoHidden && videoTextureIsCrop) {
        // The texture is already the crop: fill the media rect with it.
        videoSprite.x = mediaRect.x;
        videoSprite.y = mediaRect.y;
        videoSprite.width = mediaRect.width;
        videoSprite.height = mediaRect.height;
      } else if (currentVideoTexture && !videoHidden) {
        const scaleX = mediaRect.width / Math.max(cropRectPixels.width, 1);
        const scaleY = mediaRect.height / Math.max(cropRectPixels.height, 1);
        videoSprite.x = mediaRect.x - cropRectPixels.x * scaleX;
        videoSprite.y = mediaRect.y - cropRectPixels.y * scaleY;
        videoSprite.width = scene.sourceWidth * scaleX;
        videoSprite.height = scene.sourceHeight * scaleY;
      }

      // ── Window bar ───────────────────────────────────────────────────────
      const barScene = windowBarCtx
        ? windowBar.sceneAt(
            effectiveFrame,
            contentGeom,
            timelineT,
            { pageVisits: recordingPageVisits(renderState.recordingResult) },
            () =>
              videoSrc?.ready && videoSrc.source
                ? sampleTopBandBrightness(
                    videoSrc.source,
                    videoSrc.width,
                    videoSrc.height,
                    cropRectPixels.y,
                  )
                : null,
          )
        : null;
      windowBarSprite.visible = !!barScene && !videoHidden;
      if (barScene && windowBarCtx && !videoHidden) {
        // Pixels per bar unit: the renderer's resolution times the zoom (in
        // half steps), so a zoomed-in bar is redrawn sharp, not stretched.
        const zoomStep = Math.max(1, Math.ceil(Math.abs(scene.cameraContainer.scale.x) * 2) / 2);
        const pixelScale = Math.min(4, (scene.app.renderer.resolution || 1) * zoomStep);
        const pw = Math.max(1, Math.ceil(barScene.width * pixelScale));
        const ph = Math.max(1, Math.ceil(barScene.height * pixelScale));
        const barKey = `${pw}x${ph}|${pixelScale}|${fontsLoaded}|${JSON.stringify(barScene.ops)}`;
        if (barKey !== lastWindowBarKey) {
          const resized = windowBarCanvas.width !== pw || windowBarCanvas.height !== ph;
          if (resized) {
            windowBarCanvas.width = pw;
            windowBarCanvas.height = ph;
          }
          windowBarCtx.setTransform(1, 0, 0, 1, 0, 0);
          windowBarCtx.clearRect(0, 0, pw, ph);
          drawWindowBar(windowBarCtx, barScene, 0, 0, pixelScale);
          if (!windowBarSource || resized) {
            windowBarSource?.destroy();
            windowBarSource = new CanvasSource({ resource: windowBarCanvas });
            windowBarSprite.texture = new Texture({ source: windowBarSource });
          } else {
            windowBarSource.update();
          }
          lastWindowBarKey = barKey;
        }
        windowBarSprite.x = windowRect.x;
        windowBarSprite.y = windowRect.y;
        windowBarSprite.width = barScene.width;
        windowBarSprite.height = barScene.height;
      }

      // ── Media mask + BgRepaint mask (share the same geometry) ────────────
      // Only redrawn when geometry changes — e.g. user adjusts padding or corner
      // radius. During playback this is static, so we skip 3 GPU buffer uploads/frame.
      const mediaMaskKey = `${windowRect.x}|${windowRect.y}|${windowRect.width}|${windowRect.height}|${mediaRadius}`;
      if (mediaMaskKey !== lastMediaMaskKey) {
        mediaMask.clear();
        mediaMask.roundRect(
          windowRect.x,
          windowRect.y,
          windowRect.width,
          windowRect.height,
          mediaRadius,
        );
        mediaMask.fill(0xffffff);
        // BgRepaint mask shares the same rect — update together.
        bgRepaintMask.clear();
        bgRepaintMask.roundRect(
          windowRect.x,
          windowRect.y,
          windowRect.width,
          windowRect.height,
          mediaRadius,
        );
        bgRepaintMask.fill(0xffffff);
        lastMediaMaskKey = mediaMaskKey;
      }

      // ── Content mask ─────────────────────────────────────────────────────
      const contentMaskKey = `${contentRect.x}|${contentRect.y}|${contentRect.width}|${contentRect.height}|${contentRadius}`;
      if (contentMaskKey !== lastContentMaskKey) {
        contentMask.clear();
        contentMask.roundRect(
          contentRect.x,
          contentRect.y,
          contentRect.width,
          contentRect.height,
          contentRadius,
        );
        contentMask.fill(0xffffff);
        lastContentMaskKey = contentMaskKey;
      }

      // ── Shadow filter ────────────────────────────────────────────────────
      const shadowKey = [
        shadowBlur,
        shadowOpacity,
        windowRect.x,
        windowRect.y,
        windowRect.width,
        windowRect.height,
        mediaRadius,
        ch,
      ].join('|');
      if (shadowKey !== lastShadowKey) {
        shadowShape.clear();
        if (shadowBlur > 0 && shadowOpacity > 0) {
          const scaledBlur = shadowBlur * (ch / 1080);
          shadowBlurFilter.blur = scaledBlur;
          shadowShape.visible = true;
          shadowShape.alpha = shadowOpacity;
          baseShadowX = 0;
          baseShadowY = scaledBlur * 0.25;
          baseShadowOpacity = shadowOpacity;
          shadowShape.x = baseShadowX;
          shadowShape.y = baseShadowY;
          shadowShape
            .roundRect(windowRect.x, windowRect.y, windowRect.width, windowRect.height, mediaRadius)
            .fill(0x000000);
          shadowShape.filters = [shadowBlurFilter];
        } else {
          shadowShape.visible = false;
          shadowShape.alpha = 0;
          shadowShape.filters = null;
        }
        lastShadowKey = shadowKey;
      }

      // ── Background ───────────────────────────────────────────────────────
      // During export the stage is shifted right by contentOffsetX so non-16:9
      // content is centered in the standard encoder canvas. To fill the full
      // rendered frame without black bars, position every background sprite at
      // (-bgOffsetX, -bgOffsetY) in stage space so its left/top edge lands at
      // renderer (0, 0) after the stage shift is applied.
      const bgOffsetX = Math.floor((cw - gcw) / 2);
      const bgOffsetY = Math.floor((ch - gch) / 2);

      bgSolid.visible = bgType === 'solid';
      bgGradient.visible = bgType === 'gradient';
      bgWallpaper.visible = bgType === 'wallpaper';
      blurState.bgSprite.visible = bgType === 'blur';

      bgRepaintSolid.visible = bgType === 'solid';
      bgRepaintGradient.visible = bgType === 'gradient';
      bgRepaintWallpaper.visible = bgType === 'wallpaper';
      bgRepaintBlur.visible = bgType === 'blur';

      if (bgType === 'solid') {
        if (background.solidColor !== lastSolidColor) {
          const color = parseInt(background.solidColor.replace('#', ''), 16);
          bgSolid.clear().rect(-bgOffsetX, -bgOffsetY, cw, ch).fill(color);
          bgRepaintSolid.clear().rect(-bgOffsetX, -bgOffsetY, cw, ch).fill(color);
          lastSolidColor = background.solidColor;
        }
      } else if (bgType === 'gradient') {
        const gradKey = buildGradientKey(background);
        if (gradKey !== lastGradientKey) {
          const tex = createGradientTexture(background, cw, ch);
          bgGradient.texture = tex;
          bgGradient.x = -bgOffsetX;
          bgGradient.y = -bgOffsetY;
          bgGradient.width = cw;
          bgGradient.height = ch;
          bgRepaintGradient.texture = tex;
          bgRepaintGradient.x = -bgOffsetX;
          bgRepaintGradient.y = -bgOffsetY;
          bgRepaintGradient.width = cw;
          bgRepaintGradient.height = ch;
          lastGradientKey = gradKey;
        }
      } else if (bgType === 'wallpaper') {
        const preset = resolveWallpaperPreset(background.wallpaperSeed);
        const tex = getWallpaperTexture(preset.url);
        if (tex && tex.width > 0 && tex.height > 0) {
          if (background.wallpaperSeed !== lastWallpaperSeed) {
            const scale = Math.max(cw / tex.width, ch / tex.height);
            const sw = tex.width * scale;
            const sh = tex.height * scale;
            bgWallpaper.texture = tex;
            bgWallpaper.x = -bgOffsetX + (cw - sw) / 2;
            bgWallpaper.y = -bgOffsetY + (ch - sh) / 2;
            bgWallpaper.width = sw;
            bgWallpaper.height = sh;
            bgRepaintWallpaper.texture = tex;
            bgRepaintWallpaper.x = -bgOffsetX + (cw - sw) / 2;
            bgRepaintWallpaper.y = -bgOffsetY + (ch - sh) / 2;
            bgRepaintWallpaper.width = sw;
            bgRepaintWallpaper.height = sh;
            lastWallpaperSeed = background.wallpaperSeed;
          }
        }
        // If tex is null or 0×0 the image hasn't loaded yet — skip this frame
        // and leave lastWallpaperSeed unchanged so we retry next frame.
      } else if (bgType === 'blur') {
        updateBlurBg(blurState, scene, currentVideoTexture, background.blurIntensity, cw, ch, t);
        blurState.bgSprite.x = -bgOffsetX - 4;
        blurState.bgSprite.y = -bgOffsetY - 4;
        // Repaint sprite shares the same render texture.
        bgRepaintBlur.texture = blurState.renderTexture;
        bgRepaintBlur.x = -bgOffsetX - 4;
        bgRepaintBlur.y = -bgOffsetY - 4;
        bgRepaintBlur.width = cw + 8;
        bgRepaintBlur.height = ch + 8;
        bgRepaintBlur.filters = [blurState.blurFilter, blurState.colorFilter];
      }
    };
  },
};
