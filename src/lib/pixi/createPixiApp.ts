import { Application, Container } from 'pixi.js';
import type { PixiScene } from './types';

// Preview renders at CSS pixel density (1:1) so the RAF loop stays smooth even
// on high-resolution Retina displays. Resolution=1 matches the export renderer
// profile and cuts rendered pixels by ~75% versus native 2× DPR.
// Export is unaffected: it always renders frame-by-frame at the encoder resolution.
const PREVIEW_MAX_RESOLUTION = 1.0;

export function getPreviewRendererResolution(): number {
  const ratio = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  const clamped = Number.isFinite(ratio) ? Math.max(1, ratio) : 1;
  return Math.min(clamped, PREVIEW_MAX_RESOLUTION);
}

function buildSceneGraph(
  app: Application,
): Omit<PixiScene, 'app' | 'sourceWidth' | 'sourceHeight'> {
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
  app.stage.addChild(backgroundContainer, compositeContainer, overlayContainer);

  return {
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
    antialias: false,
    // Project thumbnails read the preview canvas via toDataURL(). WebGL may
    // otherwise expose a cleared buffer even when the on-screen preview is fine.
    preserveDrawingBuffer: true,
    failIfMajorPerformanceCaveat: false,
    resolution: getPreviewRendererResolution(),
    autoDensity: false,
    roundPixels: false,
    preference: 'webgl',
    powerPreference: 'high-performance',
    autoStart: false,
  });

  const containers = buildSceneGraph(app);
  return { app, ...containers, sourceWidth: 1280, sourceHeight: 800, renderScale: 1 };
}

/**
 * Creates a PixiJS Application for frame-accurate export.
 *
 * resolution=1 — renderSizing scales the canvas to the encoder target resolution
 * so captureTimeline's drawImage step is always a 1:1 pixel blit.
 * autoStart=false — captureTimeline drives rendering one frame at a time.
 * antialias=false — MSAA disabled to avoid per-frame GPU overhead; the 1:1 blit
 * means there is no downstream downscale that would otherwise justify MSAA.
 */
export async function createExportPixiApp(width: number, height: number): Promise<PixiScene> {
  const app = new Application();

  await app.init({
    width,
    height,
    backgroundAlpha: 0,
    antialias: false,
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
