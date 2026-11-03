import type { RecordingResult } from '../../types/index';

export interface RenderSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  ready: boolean;
}

export interface RenderContext {
  videoSource: RenderSource | null;
  cameraSource?: RenderSource | null;
  /** Export only: the output timeline time for this frame (seconds). Absent in preview. */
  outputTime?: number;
}

export type FrameWrapper = (
  ctx: CanvasRenderingContext2D,
  next: () => void,
  t: number,
  dt: number,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  renderContext: RenderContext,
) => void;

export interface CanvasLayer {
  draw(
    ctx: CanvasRenderingContext2D,
    t: number,
    sourceWidth: number,
    sourceHeight: number,
    canvasWidth: number,
    canvasHeight: number,
    dt?: number,
    renderContext?: RenderContext,
  ): void;
  /**
   * Controls when this layer is drawn relative to frame wrappers.
   * - 'content' (default): drawn inside active transforms — use for cursor, highlights
   * - 'overlay': drawn after all transforms collapse — use for watermarks, fixed captions
   */
  phase?: 'content' | 'overlay';
}

/**
 * A self-contained unit of post-processing that runs after a recording loads.
 *
 * Lifecycle:
 *   1. `analyze(recording)` — called once when a recording loads. Heavy
 *      pre-processing (event normalisation, cluster detection, etc.) belongs
 *      here. The returned `TData` is passed to all other methods.
 *
 *   2. `onLoad(data)` — called once immediately after `analyze`. Use this for
 *      side effects such as seeding a store with auto-detected clips. Keeps
 *      store interactions out of the pipeline and inside the effect that owns them.
 *
 *   3. Per-frame (called every RAF tick):
 *      - `createFrameWrapper(data, allData)` — called once when the recording loads.
 *        Returns a middleware function
 *        `(ctx, next, t, dt, sourceWidth, sourceHeight, canvasWidth, canvasHeight, renderContext) => void`.
 *        Calling
 *        `next()` draws the video frame and all 'content' phase layers. Wrap it with
 *        canvas operations for transforms (zoom, spotlight, color grade, etc.).
 *        Per-frame easing state belongs in the returned function's closure.
 *      - `createLayer(data)` — return a `CanvasLayer` drawn every frame. Set
 *        `phase: 'content'` (default) to draw inside active transforms, or
 *        `phase: 'overlay'` to draw on top of everything (watermarks, fixed UI).
 */
export interface Effect<TData = unknown> {
  /** Unique identifier for this effect. Used as the key in the analyzed-data map. */
  id: string;

  /**
   * Pre-processes the recording into effect-specific data.
   * Called once when a recording loads; result is passed to all other methods.
   * Must be pure — no side effects.
   */
  analyze(recording: RecordingResult): TData;

  /**
   * Called once immediately after `analyze`. Use for side effects that belong
   * to this effect (e.g. seeding the store with auto-detected clips).
   * Runs inside a React `useEffect` — safe to call store setters here.
   */
  onLoad?(data: TData): void;

  /**
   * Returns a `CanvasLayer` drawn every RAF frame. Set `phase: 'content'`
   * (default) to draw inside active transforms, or `phase: 'overlay'` to draw
   * on top of everything after all transforms have been applied.
   */
  createLayer?(data: TData): CanvasLayer;

  /**
   * Called once when a recording loads. Returns a per-frame middleware function.
   *
   * The middleware receives `next` — calling it draws the video frame and all
   * 'content' phase layers. Wrap `next()` with canvas operations to apply
   * transforms, filters, or any effect that needs to surround the content draw.
   *
   * Per-frame easing/interpolation state belongs in the closure of the returned
   * function, not in `createFrameWrapper` itself.
   *
   * `renderContext` carries frame-local media sources so preview and export can
   * share the same pipeline while using different underlying source objects.
   *
   * `allData` contains analyzed data for every registered effect, keyed by
   * effect id. Use this to depend on another effect's data
   * (e.g. zoom reads cursor positions from the cursor effect).
   */
  createFrameWrapper?(data: TData, allData: Map<string, unknown>): FrameWrapper;
}
