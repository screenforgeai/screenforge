import { describe, expect, it, vi } from 'vitest';
import { drawEffectPipeline } from './pipeline';
import type { CanvasLayer, FrameWrapper, RenderContext } from './types';

describe('drawEffectPipeline', () => {
  it('draws base content inside wrappers and overlays afterward', () => {
    const calls: string[] = [];
    const renderContext: RenderContext = {
      videoSource: {
        source: {} as CanvasImageSource,
        width: 1920,
        height: 1080,
        ready: true,
      },
    };

    const contentLayer: CanvasLayer = {
      draw: vi.fn((_ctx, _t, _sw, _sh, _cw, _ch, _dt, incomingContext) => {
        calls.push(`content:${incomingContext === renderContext}`);
      }),
    };

    const overlayLayer: CanvasLayer = {
      phase: 'overlay',
      draw: vi.fn((_ctx, _t, _sw, _sh, _cw, _ch, _dt, incomingContext) => {
        calls.push(`overlay:${incomingContext === renderContext}`);
      }),
    };

    const outerWrapper: FrameWrapper = vi.fn(
      (_ctx, next, _t, _dt, _sw, _sh, _cw, _ch, incomingContext) => {
        calls.push(`outer:start:${incomingContext === renderContext}`);
        next();
        calls.push('outer:end');
      },
    );

    const innerWrapper: FrameWrapper = vi.fn(
      (_ctx, next, _t, _dt, _sw, _sh, _cw, _ch, incomingContext) => {
        calls.push(`inner:start:${incomingContext === renderContext}`);
        next();
        calls.push('inner:end');
      },
    );

    drawEffectPipeline({
      ctx: {} as CanvasRenderingContext2D,
      t: 1.25,
      dt: 1 / 60,
      sourceWidth: 1920,
      sourceHeight: 1080,
      canvasWidth: 1920,
      canvasHeight: 1080,
      renderContext,
      contentLayers: [contentLayer],
      overlayLayers: [overlayLayer],
      frameWrappers: [outerWrapper, innerWrapper],
      drawBase: () => {
        calls.push('base');
      },
    });

    expect(calls).toEqual([
      'outer:start:true',
      'inner:start:true',
      'base',
      'content:true',
      'inner:end',
      'outer:end',
      'overlay:true',
    ]);
  });
});
