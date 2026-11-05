import type { Application, Container } from 'pixi.js';
import type { RecordingResult } from '../../types';
import type { RenderContext } from '../effects/types';

/**
 * All PixiJS display containers that make up the scene graph.
 *
 * Hierarchy (outermost → innermost):
 *   stage
 *   ├── backgroundContainer  ← solid / gradient / blur / wallpaper (always full canvas)
 *   ├── motionContainer      ← motion clips: scale, offset, rotation, 3D tilt, opacity
 *   │   ├── compositeContainer   ← always identity; recording panel position driven by frame effect geometry
 *   │   │   └── cameraContainer  ← zoom pivot: scale + position applied here
 *   │   │       ├── frameContainer   ← cinematic tilt target: shadow + preview
 *   │   │       │   └── videoContainer  ← content mask + video sprite
 *   │   │       └── contentContainer ← reserved for content-phase overlays
 *   │   └── motionOverlayContainer ← cursor, masks — NOT zoomed, but move with the recording
 *   └── overlayContainer  ← camera PIP, text, captions, keys — fixed to the canvas
 */
export interface PixiScene {
  app: Application;
  motionContainer: Container;
  motionOverlayContainer: Container;
  compositeContainer: Container;
  cameraContainer: Container;
  backgroundContainer: Container;
  frameContainer: Container;
  videoContainer: Container;
  contentContainer: Container;
  overlayContainer: Container;
  /** Source video natural pixel dimensions — updated by the frame effect when video loads. */
  sourceWidth: number;
  sourceHeight: number;
  /**
   * Ratio of the PixiJS canvas size to the original source dimensions.
   * Set to the renderScale from computeExportRenderSize during export so the
   * zoom effect can apply base sharpening to compensate for source downscaling
   * (e.g. ~0.57 for a 3360×2100 Retina source exported to 1920×1080).
   * Always 1.0 for preview — the preview canvas is at full geometry resolution.
   */
  renderScale: number;
}

/**
 * Called every RAF tick (preview) or once per export frame.
 * Each effect returns one of these from its `setup()` call.
 */
export type PixiEffectUpdater = (t: number, dt: number, renderContext: RenderContext) => void;

/**
 * PixiJS-native equivalent of the Canvas 2D `Effect<TData>` interface.
 *
 * `analyze` and `onLoad` are identical in contract — pure pre-processing and
 * store side-effects respectively. `setup` replaces `createFrameWrapper` /
 * `createLayer`: it receives the initialized PixiJS scene, adds display
 * objects, and returns a per-frame updater.
 */
export interface PixiEffect<TData = unknown> {
  id: string;
  analyze(recording: RecordingResult): TData;
  onLoad?(data: TData): void;
  /**
   * Called once after the PixiJS Application is initialized and the base scene
   * graph is built. Add display objects to the appropriate containers here.
   * Returns a per-frame updater (or void if no per-frame work is needed).
   * May be async to allow texture pre-loading.
   */
  setup?(
    data: TData,
    allData: Map<string, unknown>,
    scene: PixiScene,
  ): PixiEffectUpdater | void | Promise<PixiEffectUpdater | void>;
}
