import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import type { RecordingResult } from '../types/index';
import {
  capturePreviewFrameCanvas,
  capturePreviewThumbnailCanvas,
} from '../lib/pixi/previewThumbnail';
import { invalidatePreview } from '../lib/pixi/previewInvalidation';
import { isPreviewDrawing } from '../lib/pixi/previewActivity';
import { usePixiRenderer } from './usePixiRenderer';

const pixi = vi.hoisted(() => ({
  createPreviewPixiApp: vi.fn(),
  setupPixiPipeline: vi.fn(),
  stepPixiSystemTicker: vi.fn(),
}));

vi.mock('../lib/pixi/createPixiApp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/pixi/createPixiApp')>();
  return {
    createPreviewPixiApp: pixi.createPreviewPixiApp,
    fitPreviewResolution: actual.fitPreviewResolution,
    // The fake renderer has no view texture; resizePreviewRenderer has its own tests.
    resizePreviewRenderer: (
      renderer: { resize: (w: number, h: number, r: number) => void },
      width: number,
      height: number,
      resolution: number,
    ) => renderer.resize(width, height, resolution),
    stepPixiSystemTicker: pixi.stepPixiSystemTicker,
  };
});

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

const fakePoint = (v: number) => ({ x: v, y: v, set: vi.fn() });
const fakeContainer = () => ({
  removeChildren: vi.fn(),
  addChild: vi.fn(),
  scale: fakePoint(1),
  pivot: fakePoint(0),
  position: fakePoint(0),
  skew: fakePoint(0),
  rotation: 0,
  alpha: 1,
  children: [],
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
    motionContainer: fakeContainer(),
    motionOverlayContainer: fakeContainer(),
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

  it('stops drawing the preview while the screenshot editor covers it', async () => {
    const scene = fakeScene();
    pixi.createPreviewPixiApp.mockResolvedValue(scene);
    pixi.setupPixiPipeline.mockResolvedValue([]);
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 1280 });
    Object.defineProperty(video, 'videoHeight', { value: 720 });
    renderHook(() =>
      usePixiRenderer(
        { current: document.createElement('canvas') },
        { current: video },
        recording('/a.mp4'),
      ),
    );
    await act(async () => undefined);
    runFrames(1);
    expect(scene.app.renderer.render).toHaveBeenCalled();

    // The screenshot editor opens over the whole window: the GPU is all its own.
    act(() =>
      useStore.setState({
        screenshotCapture: { kind: 'area', imageUrl: 'blob:shot', width: 800, height: 600 },
      }),
    );
    scene.app.renderer.render.mockClear();
    runFrames(3);
    expect(scene.app.renderer.render).not.toHaveBeenCalled();

    act(() => useStore.setState({ screenshotCapture: null }));
    runFrames(1);
    expect(scene.app.renderer.render).toHaveBeenCalled();
  });

  it('draws a frame on demand for the project thumbnail, and stops offering one when closed', async () => {
    const scene = fakeScene();
    scene.app.canvas.width = 1280;
    scene.app.canvas.height = 720;
    pixi.createPreviewPixiApp.mockResolvedValue(scene);
    pixi.setupPixiPipeline.mockResolvedValue([]);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 1280 });
    Object.defineProperty(video, 'videoHeight', { value: 720 });
    const { unmount } = renderHook(() =>
      usePixiRenderer(
        { current: document.createElement('canvas') },
        { current: video },
        recording('/a.mp4'),
      ),
    );
    await act(async () => undefined);
    scene.app.renderer.render.mockClear();

    const thumbnail = capturePreviewThumbnailCanvas();

    // Drawn now, not read from a kept buffer, then copied off at thumbnail size.
    expect(scene.app.renderer.render).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(scene.app.canvas, 0, 0, 480, 270);
    expect(thumbnail?.width).toBe(480);

    unmount();
    expect(capturePreviewThumbnailCanvas()).toBeNull();
  });

  it('draws only as many pixels as the preview shows, laid out in the recording pixels', async () => {
    const scene = fakeScene();
    vi.spyOn(scene.app.canvas, 'getBoundingClientRect').mockReturnValue({
      width: 640,
      height: 360,
    } as DOMRect);
    pixi.createPreviewPixiApp.mockResolvedValue(scene);
    pixi.setupPixiPipeline.mockResolvedValue([]);
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 2560 });
    Object.defineProperty(video, 'videoHeight', { value: 1440 });
    Object.defineProperty(video, 'readyState', { value: 1 });
    renderHook(() =>
      usePixiRenderer(
        { current: document.createElement('canvas') },
        { current: video },
        recording('/a.mp4'),
      ),
    );
    await act(async () => undefined);

    const [width, height, resolution] = scene.app.renderer.resize.mock.calls.at(-1) as number[];
    // Effects keep working in the recording's pixels...
    expect(width).toBeGreaterThanOrEqual(2560);
    // ...while the buffer covers what is shown, not the whole recording.
    expect(resolution).toBeLessThan(0.5);
    expect(width * resolution).toBeGreaterThanOrEqual(640);
    expect(height * resolution).toBeGreaterThanOrEqual(360);
  });

  it('draws a frame screenshot at full resolution, then puts the smaller buffer back', async () => {
    const scene = fakeScene();
    Object.assign(scene.app.renderer, { resolution: 0.25, width: 2560, height: 1440 });
    pixi.createPreviewPixiApp.mockResolvedValue(scene);
    pixi.setupPixiPipeline.mockResolvedValue([]);
    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', { value: 2560 });
    Object.defineProperty(video, 'videoHeight', { value: 1440 });
    renderHook(() =>
      usePixiRenderer(
        { current: document.createElement('canvas') },
        { current: video },
        recording('/a.mp4'),
      ),
    );
    await act(async () => undefined);
    scene.app.renderer.resize.mockClear();
    let resizesWhenRead = -1;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {
        resizesWhenRead = scene.app.renderer.resize.mock.calls.length;
      },
    } as unknown as CanvasRenderingContext2D);
    scene.app.canvas.width = 2560;
    scene.app.canvas.height = 1440;

    const shot = capturePreviewFrameCanvas();

    expect(scene.app.renderer.resize.mock.calls).toEqual([
      [2560, 1440, 1],
      [2560, 1440, 0.25],
    ]);
    // Copied while the full-resolution frame was on the canvas.
    expect(resizesWhenRead).toBe(1);
    expect(shot?.width).toBe(2560);
  });

  describe('drawing on demand', () => {
    let clock: number;

    const mountPreview = async (paused: boolean) => {
      clock = 1_000;
      vi.spyOn(performance, 'now').mockImplementation(() => clock);
      const scene = fakeScene();
      pixi.createPreviewPixiApp.mockResolvedValue(scene);
      const updater = vi.fn();
      pixi.setupPixiPipeline.mockResolvedValue([updater]);
      const video = document.createElement('video');
      Object.defineProperty(video, 'videoWidth', { value: 1280 });
      Object.defineProperty(video, 'videoHeight', { value: 720 });
      Object.defineProperty(video, 'paused', { get: () => paused });
      renderHook(() =>
        usePixiRenderer(
          { current: document.createElement('canvas') },
          { current: video },
          recording('/a.mp4'),
        ),
      );
      await act(async () => undefined);
      return { scene, updater, video };
    };
    // One frame every 16 ms of the fake clock.
    const advance = (ms: number) => {
      const end = clock + ms;
      while (clock < end) {
        clock += 16;
        runFrames(1);
      }
    };

    it('keeps drawing after a paused change until the scene settles, then stops', async () => {
      const { scene, updater } = await mountPreview(true);

      // Effects smooth with dt (the cursor spring), so it must not stop after one frame.
      advance(500);
      expect(updater.mock.calls.length).toBeGreaterThan(20);
      const dts = updater.mock.calls.map((call) => call[1] as number);
      expect(Math.max(...dts)).toBeLessThanOrEqual(0.05);

      advance(1_000);
      scene.app.renderer.render.mockClear();
      advance(2_000);
      expect(scene.app.renderer.render).not.toHaveBeenCalled();
      expect(frames).toHaveLength(0);
    });

    it("steps Pixi's system ticker with each drawn frame, and not while settled", async () => {
      const { scene } = await mountPreview(true);
      pixi.stepPixiSystemTicker.mockClear();
      scene.app.renderer.render.mockClear();
      advance(200);
      expect(pixi.stepPixiSystemTicker.mock.calls.length).toBeGreaterThan(0);
      expect(pixi.stepPixiSystemTicker).toHaveBeenCalledTimes(
        scene.app.renderer.render.mock.calls.length,
      );

      advance(2_000);
      pixi.stepPixiSystemTicker.mockClear();
      advance(1_000);
      expect(pixi.stepPixiSystemTicker).not.toHaveBeenCalled();
    });

    it('tells the background pre-render when it draws and when it sleeps', async () => {
      await mountPreview(true);
      advance(100);
      expect(isPreviewDrawing()).toBe(true);

      advance(3_000);
      expect(isPreviewDrawing()).toBe(false);

      act(() => useStore.setState({ cursorSize: 2.5 }));
      expect(isPreviewDrawing()).toBe(true);

      cleanup();
      expect(isPreviewDrawing()).toBe(false);
    });

    it('wakes for an edit made while paused', async () => {
      const { scene } = await mountPreview(true);
      advance(2_000);
      scene.app.renderer.render.mockClear();

      act(() => useStore.setState({ cursorSize: 2.5 }));
      advance(100);

      expect(scene.app.renderer.render).toHaveBeenCalled();
    });

    it('wakes for a seek and for an asset that finished loading', async () => {
      const { scene, video } = await mountPreview(true);
      advance(2_000);

      scene.app.renderer.render.mockClear();
      video.dispatchEvent(new Event('seeked'));
      advance(100);
      expect(scene.app.renderer.render).toHaveBeenCalled();

      advance(2_000);
      scene.app.renderer.render.mockClear();
      invalidatePreview();
      advance(100);
      expect(scene.app.renderer.render).toHaveBeenCalled();
    });

    it('stays awake while an effect is still moving the camera on its own', async () => {
      const { scene, updater } = await mountPreview(true);
      // The zoom camera eases toward its follow target for seconds after a seek.
      let easing = true;
      updater.mockImplementation(() => {
        if (easing) {
          scene.cameraContainer.pivot.x += 1;
        }
      });

      advance(3_000);
      scene.app.renderer.render.mockClear();
      advance(500);
      expect(scene.app.renderer.render).toHaveBeenCalled();

      // Once it rests, the preview settles and stops.
      easing = false;
      advance(1_500);
      scene.app.renderer.render.mockClear();
      advance(1_000);
      expect(scene.app.renderer.render).not.toHaveBeenCalled();
    });

    it('draws every frame while the video plays, changed or not', async () => {
      const { scene } = await mountPreview(false);
      advance(2_000);
      scene.app.renderer.render.mockClear();

      advance(1_600);

      expect(scene.app.renderer.render.mock.calls.length).toBeGreaterThanOrEqual(99);
    });
  });
});
