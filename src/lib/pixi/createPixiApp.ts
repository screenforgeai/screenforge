import { Application, Container, Ticker, type Renderer } from 'pixi.js';
import type { PixiScene } from './types';

// The preview's scene is laid out in the recording's own pixels (its logical size),
// so every effect works in the same units as export. Its drawing buffer is sized
// separately, by the renderer's resolution: at most 1 (the recording's pixels),
// and below that the size the canvas is shown at (fitPreviewResolution).
// Export is unaffected: it always renders frame-by-frame at the encoder resolution.
const PREVIEW_MAX_RESOLUTION = 1.0;

export function getPreviewRendererResolution(): number {
  const ratio = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  const clamped = Number.isFinite(ratio) ? Math.max(1, ratio) : 1;
  return Math.min(clamped, PREVIEW_MAX_RESOLUTION);
}

/**
 * The drawing buffer grows and shrinks in steps of this many device pixels, so
 * small layout changes (a divider drag, a panel opening) reuse the buffer instead
 * of reallocating it, and the image is never drawn smaller than it is shown.
 */
export const PREVIEW_BUFFER_STEP_PX = 128;
const MIN_PREVIEW_RESOLUTION = 0.05;

/**
 * Renderer resolution that draws the preview at the size it is shown on screen,
 * never above the recording's own pixels. The canvas box is `object-fit:
 * contain`, so the image shows at the logical size scaled to fit inside the box
 * (CSS px × devicePixelRatio). Drawing a 2560×1440 recording into a preview shown
 * ~700 px wide drew ~13× more pixels (with 4× MSAA) than anyone saw. Falls back to
 * full resolution while the canvas has no layout size yet.
 */
export function fitPreviewResolution({
  logicalWidth,
  logicalHeight,
  displayWidth,
  displayHeight,
  devicePixelRatio,
}: {
  logicalWidth: number;
  logicalHeight: number;
  displayWidth: number;
  displayHeight: number;
  devicePixelRatio: number;
}): number {
  if (!(logicalWidth > 0 && logicalHeight > 0 && displayWidth > 0 && displayHeight > 0)) {
    return PREVIEW_MAX_RESOLUTION;
  }
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  // Device pixels across the image as shown (contained in the box).
  const shownScale = Math.min(displayWidth / logicalWidth, displayHeight / logicalHeight) * dpr;
  const shownWidth = logicalWidth * shownScale;
  const steppedWidth = Math.ceil(shownWidth / PREVIEW_BUFFER_STEP_PX) * PREVIEW_BUFFER_STEP_PX;
  const wanted = steppedWidth / logicalWidth;
  const clamped = Math.min(PREVIEW_MAX_RESOLUTION, Math.max(MIN_PREVIEW_RESOLUTION, wanted));
  // A whole number of buffer pixels across, so the logical width stays exactly
  // the recording's (Pixi derives it back from the rounded pixel width).
  return Math.max(1, Math.round(logicalWidth * clamped)) / logicalWidth;
}

type ResizableRenderer = Pick<Renderer, 'resize' | 'width' | 'height'> & {
  view: { texture: { source: { width: number; height: number }; update: () => void } };
};

/**
 * renderer.resize that always takes the new layout size. When the buffer keeps
 * its pixel size (a crop changes the layout, but the preview is shown just as
 * big), Pixi skips the resize and keeps the old layout size as the renderer's
 * width/height, so effects laid the scene out at the old size: after uncropping,
 * the picture filled only part of the preview. Refreshing the view texture's
 * frame (Texture.update) and resizing again applies it.
 */
export function resizePreviewRenderer(
  renderer: ResizableRenderer,
  width: number,
  height: number,
  resolution: number,
): void {
  renderer.resize(width, height, resolution);
  const { texture } = renderer.view;
  if (renderer.width !== texture.source.width || renderer.height !== texture.source.height) {
    texture.update();
    renderer.resize(width, height, resolution);
  }
}

function buildSceneGraph(
  app: Application,
): Omit<PixiScene, 'app' | 'sourceWidth' | 'sourceHeight'> {
  const motionContainer = new Container();
  const motionOverlayContainer = new Container();
  const compositeContainer = new Container();
  const cameraContainer = new Container();
  const backgroundContainer = new Container();
  const frameContainer = new Container();
  const videoContainer = new Container();
  const contentContainer = new Container();
  const overlayContainer = new Container();

  // backgroundContainer sits directly on stage so it always fills the full canvas,
  // even when compositeContainer is scaled to a recording panel in side-camera layouts.
  // cameraContainer is the zoom pivot nested inside compositeContainer.
  frameContainer.addChild(videoContainer);
  cameraContainer.addChild(frameContainer, contentContainer);
  compositeContainer.addChild(cameraContainer);
  // motionContainer moves the recording and the overlays drawn on it (cursor,
  // masks) as one piece, over a background and under overlays that stay put.
  motionContainer.addChild(compositeContainer, motionOverlayContainer);
  app.stage.addChild(backgroundContainer, motionContainer, overlayContainer);

  return {
    motionContainer,
    motionOverlayContainer,
    compositeContainer,
    cameraContainer,
    backgroundContainer,
    frameContainer,
    videoContainer,
    contentContainer,
    overlayContainer,
  };
}

/**
 * Creates a PixiJS Application for live preview.
 *
 * Uses the display pixel ratio so Retina/HiDPI preview keeps a dense backing
 * buffer while CSS still controls the visible canvas size.
 *
 * autoStart is false — the RAF loop in usePixiRenderer drives rendering.
 */
export async function createPreviewPixiApp(canvas: HTMLCanvasElement): Promise<PixiScene> {
  const app = new Application();

  await app.init({
    canvas,
    backgroundAlpha: 0,
    // 4× MSAA: rounded corners, masks, click rings and shapes have smooth edges, not steps.
    antialias: true,
    // Project thumbnails no longer need this: they draw a frame and read it in the
    // same task (registerPreviewFrameRenderer in usePixiRenderer). It stays on
    // because turning it off measured slower on Linux/NVIDIA (GPU process CPU
    // 9.4% -> 12.8% while paused); revisit with numbers from macOS.
    preserveDrawingBuffer: true,
    failIfMajorPerformanceCaveat: false,
    resolution: getPreviewRendererResolution(),
    autoDensity: false,
    roundPixels: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
    autoStart: false,
  });

  // Pixi's system ticker runs its own requestAnimationFrame loop at display rate
  // for as long as it has listeners, and every renderer adds two: pointer-event
  // polling and the scheduler behind texture garbage collection. That kept the
  // page drawing frames while the paused preview slept. The preview uses no Pixi
  // pointer events, so the ticker stops here and the preview's own frame loop
  // steps it (stepPixiSystemTicker): garbage collection runs whenever it draws.
  // The export window has its own Pixi, and its own ticker.
  Ticker.system.autoStart = false;
  Ticker.system.stop();

  const containers = buildSceneGraph(app);
  return { app, ...containers, sourceWidth: 1280, sourceHeight: 800, renderScale: 1 };
}

/** Runs Pixi's system ticker for one preview frame (see createPreviewPixiApp). */
export function stepPixiSystemTicker(now: number): void {
  Ticker.system.update(now);
}

/**
 * Creates a PixiJS Application for frame-accurate export.
 *
 * resolution=1 — renderSizing scales the canvas to the encoder target resolution
 * so captureTimeline's drawImage step is always a 1:1 pixel blit.
 * autoStart=false — captureTimeline drives rendering one frame at a time.
 * antialias=true — 4× MSAA, as in the preview: rounded corners, masks, click rings and
 * shapes are drawn as geometry, whose edges step without it (the 1:1 blit cannot smooth them).
 */
export async function createExportPixiApp(width: number, height: number): Promise<PixiScene> {
  const app = new Application();

  await app.init({
    width,
    height,
    backgroundAlpha: 0,
    antialias: true,
    failIfMajorPerformanceCaveat: false,
    // preserveDrawingBuffer so the WebGL backbuffer remains readable after render()
    // and before the next render call — VideoFrame reads directly from the WebGL
    // canvas (IOSurface on macOS) without going through a 2D canvas intermediary.
    preserveDrawingBuffer: true,
    resolution: 1,
    autoDensity: false,
    roundPixels: false,
    preference: 'webgl',
    autoStart: false,
  });

  console.log('[ExportPixiApp] Renderer type:', app.renderer.type, '(1=WebGL, 2=WebGPU, 4=Canvas)');

  const containers = buildSceneGraph(app);
  return { app, ...containers, sourceWidth: width, sourceHeight: height, renderScale: 1 };
}
