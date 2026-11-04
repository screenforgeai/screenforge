import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingResult } from '../types/index';
import { usePixiRenderer } from './usePixiRenderer';

const pixi = vi.hoisted(() => ({
  createPreviewPixiApp: vi.fn(),
  setupPixiPipeline: vi.fn(),
}));

vi.mock('../lib/pixi/createPixiApp', () => ({
  createPreviewPixiApp: pixi.createPreviewPixiApp,
  getPreviewRendererResolution: () => 1,
}));

vi.mock('../lib/pixi/pipeline', () => ({
  analyzePixiEffects: () => new Map(),
  runPixiEffectOnLoad: () => undefined,
  setupPixiPipeline: pixi.setupPixiPipeline,
  // Like the real one: every updater runs each frame.
  tickPixiPipeline: (updaters: Array<(...args: unknown[]) => void>, ...args: unknown[]) => {
    for (const update of updaters) {
      update(...args);
    }
  },
}));

const fakeContainer = () => ({
  removeChildren: vi.fn(),
  addChild: vi.fn(),
  scale: { set: vi.fn() },
  pivot: { set: vi.fn() },
  position: { set: vi.fn() },
  skew: { set: vi.fn() },
});

// Pixi's Application.destroy() nulls its renderer, as the real one does.
const fakeScene = () => {
  const app = {
    renderer: { resize: vi.fn(), render: vi.fn(), screen: { x: 0, y: 0, width: 1, height: 1 } },
    canvas: document.createElement('canvas'),
    stage: {},
    destroy: vi.fn(() => {
      (app as { renderer: unknown }).renderer = null;
    }),
  };
  return {
    app,
    backgroundContainer: fakeContainer(),
    frameContainer: fakeContainer(),
    videoContainer: fakeContainer(),
    contentContainer: fakeContainer(),
    overlayContainer: fakeContainer(),
    compositeContainer: fakeContainer(),
    cameraContainer: fakeContainer(),
  };
};

const recording = (filePath: string) =>
  ({
    filePath,
    mouseData: [],
    duration: 5,
    startTime: 0,
    recordingArea: { x: 0, y: 0, width: 1280, height: 720 },
  }) as RecordingResult;

describe('usePixiRenderer', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const runFrames = (count: number) => {
    for (let i = 0; i < count; i++) {
      for (const cb of frames.splice(0)) {
        cb(performance.now());
      }
    }
  };

  it("never runs a destroyed scene's effects while the next recording's are still loading", async () => {
    const firstScene = fakeScene();
    pixi.createPreviewPixiApp.mockResolvedValueOnce(firstScene);
    pixi.createPreviewPixiApp.mockImplementation(async () => fakeScene());
    // The zoom effect reads its scene's renderer every frame.
    const firstUpdater = vi.fn(() => firstScene.app.renderer.screen);
    pixi.setupPixiPipeline.mockResolvedValueOnce([firstUpdater]);
    pixi.setupPixiPipeline.mockImplementation(() => new Promise(() => undefined));

    const canvasRef = { current: document.createElement('canvas') };
    const video = Object.assign(document.createElement('video'), {});
    Object.defineProperty(video, 'videoWidth', { value: 1280 });
    Object.defineProperty(video, 'videoHeight', { value: 720 });
    const videoRef = { current: video };

    const { rerender } = renderHook(
      ({ rec }: { rec: RecordingResult | null }) => usePixiRenderer(canvasRef, videoRef, rec),
      { initialProps: { rec: recording('/a.mp4') as RecordingResult | null } },
    );
    await act(async () => undefined);
    runFrames(1);
    expect(firstUpdater).toHaveBeenCalled();

    // Close the project: the preview canvas leaves the DOM and its scene is destroyed.
    canvasRef.current = null as unknown as HTMLCanvasElement;
    rerender({ rec: null });
    await act(async () => undefined);
    expect(firstScene.app.destroy).toHaveBeenCalled();

    // Open another: its scene arrives, and a frame runs before React commits it.
    let resolveScene!: (scene: ReturnType<typeof fakeScene>) => void;
    pixi.createPreviewPixiApp.mockImplementationOnce(
      () => new Promise((resolve) => (resolveScene = resolve)),
    );
    canvasRef.current = document.createElement('canvas');
    rerender({ rec: recording('/b.mp4') });
    resolveScene(fakeScene());
    // Let the scene promise settle without letting React commit (no act()).
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }

    firstUpdater.mockClear();
    expect(() => runFrames(1)).not.toThrow();
    expect(firstUpdater).not.toHaveBeenCalled();
    await act(async () => undefined);
  });
});
