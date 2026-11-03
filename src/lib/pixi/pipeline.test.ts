/**
 * Tests for the PixiJS rendering pipeline orchestration.
 *
 * The registry is mocked so tests exercise pipeline logic (analyze → setup →
 * tick) without loading PixiJS display objects or SVG assets.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  analyzePixiEffects,
  runPixiEffectOnLoad,
  setupPixiPipeline,
  tickPixiPipeline,
} from './pipeline';
import { pixiEffectRegistry } from './registry';
import type { PixiEffect, PixiScene } from './types';
import type { RecordingResult } from '../../types';
import type { RenderContext } from '../effects/types';

// Replace the real registry (which loads pixi.js effects) with a mutable stub.
vi.mock('./registry', () => ({
  pixiEffectRegistry: [] as PixiEffect<unknown>[],
}));

// Minimal RecordingResult for analyze() calls.
const mockRecording: RecordingResult = {
  filePath: '/test/recording.mp4',
  mouseData: [],
  duration: 10,
  startTime: 0,
  recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

// Minimal scene — mock effects in these tests don't use scene containers.
const mockScene = {} as unknown as PixiScene;

// Minimal RenderContext for tick calls.
const mockRenderContext: RenderContext = {
  videoSource: { source: {} as CanvasImageSource, width: 1920, height: 1080, ready: true },
};

// Reset registry between tests so each test starts with zero effects.
beforeEach(() => {
  (pixiEffectRegistry as PixiEffect<unknown>[]).length = 0;
});

// ── analyzePixiEffects ────────────────────────────────────────────────────────

describe('analyzePixiEffects', () => {
  it('returns an empty map when the registry is empty', () => {
    const result = analyzePixiEffects(mockRecording);
    expect(result.size).toBe(0);
  });

  it('calls analyze on each registered effect and stores results by id', () => {
    const analyzeA = vi.fn().mockReturnValue({ data: 'a' });
    const analyzeB = vi.fn().mockReturnValue({ data: 'b' });

    (pixiEffectRegistry as PixiEffect<unknown>[]).push(
      { id: 'effectA', analyze: analyzeA },
      { id: 'effectB', analyze: analyzeB },
    );

    const result = analyzePixiEffects(mockRecording);

    expect(analyzeA).toHaveBeenCalledOnce();
    expect(analyzeA).toHaveBeenCalledWith(mockRecording);
    expect(analyzeB).toHaveBeenCalledOnce();
    expect(analyzeB).toHaveBeenCalledWith(mockRecording);
    expect(result.get('effectA')).toEqual({ data: 'a' });
    expect(result.get('effectB')).toEqual({ data: 'b' });
  });

  it('applies remapData to each effect result when provided', () => {
    const analyzeA = vi.fn().mockReturnValue('original');
    (pixiEffectRegistry as PixiEffect<unknown>[]).push({ id: 'effectA', analyze: analyzeA });

    const remapData = vi
      .fn()
      .mockImplementation((_id: string, data: unknown) => `remapped:${data}`);
    const result = analyzePixiEffects(mockRecording, { remapData });

    expect(remapData).toHaveBeenCalledWith('effectA', 'original');
    expect(result.get('effectA')).toBe('remapped:original');
  });

  it('uses remapData result when provided, original otherwise', () => {
    const analyzeA = vi.fn().mockReturnValue('a-data');
    const analyzeB = vi.fn().mockReturnValue('b-data');
    (pixiEffectRegistry as PixiEffect<unknown>[]).push(
      { id: 'effectA', analyze: analyzeA },
      { id: 'effectB', analyze: analyzeB },
    );

    // Only remap effectA.
    const remapData = vi
      .fn()
      .mockImplementation((id: string, data: unknown) =>
        id === 'effectA' ? `remapped:${data}` : data,
      );
    const result = analyzePixiEffects(mockRecording, { remapData });

    expect(result.get('effectA')).toBe('remapped:a-data');
    expect(result.get('effectB')).toBe('b-data');
  });
});

// ── runPixiEffectOnLoad ───────────────────────────────────────────────────────

describe('runPixiEffectOnLoad', () => {
  it("calls onLoad with the effect's analyzed data", () => {
    const onLoadA = vi.fn();
    (pixiEffectRegistry as PixiEffect<unknown>[]).push({
      id: 'effectA',
      analyze: () => 'a-data',
      onLoad: onLoadA,
    });

    const analyzedData = new Map<string, unknown>([['effectA', 'a-data']]);
    runPixiEffectOnLoad(analyzedData);

    expect(onLoadA).toHaveBeenCalledOnce();
    expect(onLoadA).toHaveBeenCalledWith('a-data');
  });

  it('skips effects that have no onLoad', () => {
    const analyzeOnly = vi.fn().mockReturnValue('data');
    (pixiEffectRegistry as PixiEffect<unknown>[]).push({ id: 'noOnLoad', analyze: analyzeOnly });

    // Should not throw.
    const analyzedData = new Map<string, unknown>([['noOnLoad', 'data']]);
    expect(() => runPixiEffectOnLoad(analyzedData)).not.toThrow();
  });
});

// ── tickPixiPipeline ──────────────────────────────────────────────────────────

describe('tickPixiPipeline', () => {
  it('calls each updater in order with t, dt, and renderContext', () => {
    const calls: string[] = [];
    const updaterA = vi.fn((t: number, dt: number, ctx: RenderContext) => {
      calls.push(`A:${t}:${dt}:${ctx === mockRenderContext}`);
    });
    const updaterB = vi.fn((t: number, dt: number, ctx: RenderContext) => {
      calls.push(`B:${t}:${dt}:${ctx === mockRenderContext}`);
    });

    tickPixiPipeline([updaterA, updaterB], 1.5, 1 / 60, mockRenderContext);

    const expectedDt = (1 / 60).toString();
    expect(calls).toEqual([`A:1.5:${expectedDt}:true`, `B:1.5:${expectedDt}:true`]);
  });

  it('does nothing when updater list is empty', () => {
    expect(() => tickPixiPipeline([], 0, 1 / 60, mockRenderContext)).not.toThrow();
  });

  it('calls updaters in registration order', () => {
    const order: number[] = [];
    const updaters = [0, 1, 2].map((i) =>
      vi.fn(() => {
        order.push(i);
      }),
    );

    tickPixiPipeline(updaters, 0, 0, mockRenderContext);
    expect(order).toEqual([0, 1, 2]);
  });
});

// ── setupPixiPipeline ─────────────────────────────────────────────────────────

describe('setupPixiPipeline', () => {
  it('returns empty updater list when registry is empty', async () => {
    const analyzedData = new Map<string, unknown>();
    const updaters = await setupPixiPipeline(analyzedData, mockScene);
    expect(updaters).toHaveLength(0);
  });

  it('collects updaters from effects that return one from setup()', async () => {
    const updaterA = vi.fn();
    const updaterB = vi.fn();

    (pixiEffectRegistry as PixiEffect<unknown>[]).push(
      {
        id: 'effectA',
        analyze: () => null,
        setup: vi.fn().mockResolvedValue(updaterA),
      },
      {
        id: 'effectB',
        analyze: () => null,
        setup: vi.fn().mockResolvedValue(updaterB),
      },
    );

    const analyzedData = new Map<string, unknown>([
      ['effectA', null],
      ['effectB', null],
    ]);

    const updaters = await setupPixiPipeline(analyzedData, mockScene);
    expect(updaters).toHaveLength(2);
    expect(updaters[0]).toBe(updaterA);
    expect(updaters[1]).toBe(updaterB);
  });

  it('skips effects whose setup() returns undefined', async () => {
    const updaterA = vi.fn();
    (pixiEffectRegistry as PixiEffect<unknown>[]).push(
      {
        id: 'withUpdater',
        analyze: () => null,
        setup: vi.fn().mockResolvedValue(updaterA),
      },
      {
        id: 'noUpdater',
        analyze: () => null,
        setup: vi.fn().mockResolvedValue(undefined),
      },
    );

    const analyzedData = new Map<string, unknown>([
      ['withUpdater', null],
      ['noUpdater', null],
    ]);

    const updaters = await setupPixiPipeline(analyzedData, mockScene);
    expect(updaters).toHaveLength(1);
    expect(updaters[0]).toBe(updaterA);
  });

  it('skips effects that have no setup method', async () => {
    (pixiEffectRegistry as PixiEffect<unknown>[]).push({
      id: 'noSetup',
      analyze: () => null,
      // setup intentionally omitted
    });

    const analyzedData = new Map<string, unknown>([['noSetup', null]]);
    const updaters = await setupPixiPipeline(analyzedData, mockScene);
    expect(updaters).toHaveLength(0);
  });

  it('calls setup() with the correct analyzed data and scene', async () => {
    const setupFn = vi.fn().mockResolvedValue(vi.fn());
    const effectData = { some: 'data' };

    (pixiEffectRegistry as PixiEffect<unknown>[]).push({
      id: 'check',
      analyze: () => effectData,
      setup: setupFn,
    });

    const analyzedData = new Map<string, unknown>([['check', effectData]]);
    await setupPixiPipeline(analyzedData, mockScene);

    expect(setupFn).toHaveBeenCalledOnce();
    expect(setupFn).toHaveBeenCalledWith(effectData, analyzedData, mockScene);
  });

  it('calls setup() for each effect in registry order', async () => {
    const order: string[] = [];
    ['first', 'second', 'third'].forEach((id) => {
      (pixiEffectRegistry as PixiEffect<unknown>[]).push({
        id,
        analyze: () => null,
        setup: vi.fn().mockImplementation(async () => {
          order.push(id);
          return vi.fn();
        }),
      });
    });

    const analyzedData = new Map<string, unknown>([
      ['first', null],
      ['second', null],
      ['third', null],
    ]);

    await setupPixiPipeline(analyzedData, mockScene);
    expect(order).toEqual(['first', 'second', 'third']);
  });
});
