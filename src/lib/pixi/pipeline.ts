/**
 * PixiJS rendering pipeline.
 *
 * Mirrors the Canvas 2D pipeline.ts contract but for PixiJS:
 *   - `analyzePixiEffects`   — pure pre-processing, same as analyzeEffects
 *   - `runPixiEffectOnLoad`  — side effects (e.g. seeding store with zoom clips)
 *   - `setupPixiPipeline`    — async: calls each effect's setup(), collects updaters
 *   - `tickPixiPipeline`     — calls each updater in order; caller must call app.render() after
 */
import type { RecordingResult } from '../../types';
import type { RenderContext } from '../effects/types';
import type { PixiEffectUpdater, PixiScene } from './types';
import { pixiEffectRegistry } from './registry';

export interface AnalyzePixiEffectsOptions {
  /** Optional post-processing per effect (e.g. timeline remapping for export). */
  remapData?: (effectId: string, data: unknown) => unknown;
}

export function analyzePixiEffects(
  recording: RecordingResult,
  options: AnalyzePixiEffectsOptions = {},
): Map<string, unknown> {
  const analyzedData = new Map<string, unknown>();
  for (const effect of pixiEffectRegistry) {
    const analyzed = effect.analyze(recording);
    analyzedData.set(effect.id, options.remapData?.(effect.id, analyzed) ?? analyzed);
  }
  return analyzedData;
}

export function runPixiEffectOnLoad(analyzedData: Map<string, unknown>): void {
  for (const effect of pixiEffectRegistry) {
    effect.onLoad?.(analyzedData.get(effect.id));
  }
}

/**
 * Calls each effect's `setup()` in registry order.
 * May be async (e.g. cursor loads SVG textures via Assets.load).
 * Returns the list of per-frame updaters in the same order.
 * Each effect is isolated — a failure in one effect does not prevent others.
 */
export async function setupPixiPipeline(
  analyzedData: Map<string, unknown>,
  scene: PixiScene,
): Promise<PixiEffectUpdater[]> {
  const updaters: PixiEffectUpdater[] = [];

  for (const effect of pixiEffectRegistry) {
    const data = analyzedData.get(effect.id);
    try {
      const result = await effect.setup?.(data, analyzedData, scene);
      if (result) {
        updaters.push(result);
      }
    } catch (err) {
      console.error(
        `[PixiPipeline] Effect '${effect.id}' setup failed:`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  return updaters;
}

/**
 * Calls each updater in order.
 * The caller is responsible for calling `scene.app.renderer.render(scene.app.stage)`
 * after this returns (or at the end of the RAF tick).
 */
export function tickPixiPipeline(
  updaters: PixiEffectUpdater[],
  t: number,
  dt: number,
  renderContext: RenderContext,
): void {
  for (const updater of updaters) {
    updater(t, dt, renderContext);
  }
}
