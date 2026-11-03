import type { RecordingResult } from '../../types';
import { effectRegistry } from './registry';
import type { CanvasLayer, FrameWrapper, RenderContext } from './types';

export interface AnalyzeEffectsOptions {
  remapData?: (effectId: string, data: unknown) => unknown;
}

export interface BuildEffectPipelineOptions {
  excludeEffects?: ReadonlySet<string>;
}

export interface EffectPipeline {
  contentLayers: CanvasLayer[];
  overlayLayers: CanvasLayer[];
  frameWrappers: FrameWrapper[];
}

export interface DrawEffectPipelineOptions extends EffectPipeline {
  ctx: CanvasRenderingContext2D;
  t: number;
  dt: number;
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  renderContext: RenderContext;
  drawBase: () => void;
}

export function analyzeEffects(
  recording: RecordingResult,
  options: AnalyzeEffectsOptions = {},
): Map<string, unknown> {
  const analyzedData = new Map<string, unknown>();

  for (const effect of effectRegistry) {
    const analyzed = effect.analyze(recording);
    analyzedData.set(effect.id, options.remapData?.(effect.id, analyzed) ?? analyzed);
  }

  return analyzedData;
}

export function runEffectOnLoad(analyzedData: Map<string, unknown>): void {
  for (const effect of effectRegistry) {
    effect.onLoad?.(analyzedData.get(effect.id));
  }
}

export function buildEffectPipeline(
  analyzedData: Map<string, unknown>,
  options: BuildEffectPipelineOptions = {},
): EffectPipeline {
  const contentLayers: CanvasLayer[] = [];
  const overlayLayers: CanvasLayer[] = [];
  const frameWrappers: FrameWrapper[] = [];

  for (const effect of effectRegistry) {
    if (options.excludeEffects?.has(effect.id)) {
      continue;
    }

    const analyzed = analyzedData.get(effect.id);
    const layer = effect.createLayer?.(analyzed);
    if (layer) {
      if (layer.phase === 'overlay') {
        overlayLayers.push(layer);
      } else {
        contentLayers.push(layer);
      }
    }
  }

  for (const effect of effectRegistry) {
    if (options.excludeEffects?.has(effect.id)) {
      continue;
    }

    const wrapper = effect.createFrameWrapper?.(analyzedData.get(effect.id), analyzedData);
    if (wrapper) {
      frameWrappers.push(wrapper);
    }
  }

  return { contentLayers, overlayLayers, frameWrappers };
}

export function drawEffectPipeline({
  ctx,
  t,
  dt,
  sourceWidth,
  sourceHeight,
  canvasWidth,
  canvasHeight,
  renderContext,
  contentLayers,
  overlayLayers,
  frameWrappers,
  drawBase,
}: DrawEffectPipelineOptions): void {
  const drawContent = (): void => {
    drawBase();
    for (const layer of contentLayers) {
      layer.draw(ctx, t, sourceWidth, sourceHeight, canvasWidth, canvasHeight, dt, renderContext);
    }
  };

  const chained = frameWrappers.reduceRight<() => void>(
    (next, wrap) => () =>
      wrap(ctx, next, t, dt, sourceWidth, sourceHeight, canvasWidth, canvasHeight, renderContext),
    drawContent,
  );

  chained();

  for (const layer of overlayLayers) {
    layer.draw(ctx, t, sourceWidth, sourceHeight, canvasWidth, canvasHeight, dt, renderContext);
  }
}
