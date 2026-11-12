import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKGROUND } from 'src/lib/effects/frame';
import type { BackgroundSettings } from 'src/lib/effects/frame';
import {
  MAX_SCREENSHOT_DIMENSION,
  canvasPointFromImage,
  clientToCanvasPoint,
  getScreenshotGeometry,
  imagePointFromCanvas,
  renderScreenshot,
  type ScreenshotStyle,
} from './compose';
import { createShapeFromDrag, createStepShape } from './annotations';

const must = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) {
    throw new Error('expected a value');
  }
  return value;
};

const background = (patch: Partial<BackgroundSettings> = {}): BackgroundSettings => ({
  ...DEFAULT_BACKGROUND,
  type: 'solid',
  solidColor: '#123456',
  ...patch,
});

const framed = (
  patch: Partial<BackgroundSettings> = {},
  aspectRatioId = 'original',
): ScreenshotStyle => ({ frameEnabled: true, aspectRatioId, background: background(patch) });

const unframed: ScreenshotStyle = {
  frameEnabled: false,
  aspectRatioId: 'original',
  background: background(),
};

describe('getScreenshotGeometry', () => {
  it('uses the raw image size when the frame is off', () => {
    const g = getScreenshotGeometry(800, 600, unframed);
    expect(g).toMatchObject({ canvasWidth: 800, canvasHeight: 600, cornerRadius: 0 });
    expect(g.mediaRect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(g.shadowBlur).toBe(0);
  });

  it('grows the canvas around the image so the screenshot keeps its native resolution', () => {
    const g = getScreenshotGeometry(1600, 900, framed({ padding: 0.2 }));
    expect(g.mediaRect.width).toBeCloseTo(1600);
    expect(g.mediaRect.height).toBeCloseTo(900);
    expect(g.canvasWidth).toBe(2000);
    expect(g.canvasHeight).toBe(1125);
    // Padding is split evenly on both sides
    expect(g.mediaRect.x).toBeCloseTo(200);
    expect(g.mediaRect.y).toBeCloseTo(112.5);
  });

  it('applies the aspect ratio preset like videos do', () => {
    const g = getScreenshotGeometry(1600, 900, framed({ padding: 0 }, '1:1'));
    expect(g.canvasWidth).toBe(g.canvasHeight);
    expect(g.mediaRect.width).toBeCloseTo(1600);
  });

  it('caps very large outputs', () => {
    const g = getScreenshotGeometry(8000, 4000, framed({ padding: 0.4 }));
    expect(Math.max(g.canvasWidth, g.canvasHeight)).toBeLessThanOrEqual(MAX_SCREENSHOT_DIMENSION);
    expect(g.mediaRect.width).toBeLessThan(8000);
  });

  it('scales corner radius and shadow with output height like the video frame', () => {
    const g = getScreenshotGeometry(
      1728,
      864,
      framed({ padding: 0.2, cornerRadius: 12, shadowBlur: 24 }),
    );
    // canvasHeight = 864 / 0.8 = 1080 → 1:1 with the video-frame scale
    expect(g.canvasHeight).toBe(1080);
    expect(g.cornerRadius).toBeCloseTo(12);
    expect(g.shadowBlur).toBeCloseTo(24);
  });

  it('drops the shadow when its opacity is zero', () => {
    expect(getScreenshotGeometry(100, 100, framed({ shadowOpacity: 0 })).shadowBlur).toBe(0);
  });
});

describe('getScreenshotGeometry with a window bar', () => {
  const mac = { style: 'mac' as const, theme: 'light' as const, center: 'url' as const };
  const withBar = (frameEnabled: boolean): ScreenshotStyle => ({
    ...(frameEnabled ? framed({ padding: 0 }) : unframed),
    windowBar: mac,
  });

  it('writes a 1x capture at 2x, the bar above the image, sized for the window in points', () => {
    const g = getScreenshotGeometry(1280, 800, withBar(false), undefined, {
      scaleFactor: 1,
      cropped: false,
    });
    expect(g.canvasWidth).toBe(2560);
    expect(g.scale).toBe(2);
    expect(g.barHeight).toBe(72); // 36pt at 1280pt wide, at 2x
    expect(g.canvasHeight).toBe(1600 + 72);
    expect(g.mediaRect).toEqual({ x: 0, y: 72, width: 2560, height: 1600 });
    expect(g.windowRect).toEqual({ x: 0, y: 0, width: 2560, height: 1672 });
  });

  it('keeps a Retina capture at its own pixels', () => {
    const g = getScreenshotGeometry(2560, 1600, withBar(false), undefined, {
      scaleFactor: 2,
      cropped: false,
    });
    expect(g.scale).toBe(1);
    expect(g.windowPoints).toBe(1280);
    expect(g.barHeight).toBe(72);
  });

  it('wraps bar and page in the frame as one window', () => {
    const g = getScreenshotGeometry(1280, 800, withBar(true), undefined, {
      scaleFactor: 2,
      cropped: false,
    });
    expect(g.windowRect.height).toBeCloseTo(g.mediaRect.height + g.barHeight);
    expect(g.mediaRect.y).toBeCloseTo(g.windowRect.y + g.barHeight);
  });

  it('draws no bar on a cropped capture, and leaves its size alone', () => {
    const g = getScreenshotGeometry(800, 600, withBar(false), undefined, {
      scaleFactor: 1,
      cropped: true,
    });
    expect(g).toMatchObject({ canvasWidth: 800, canvasHeight: 600, barHeight: 0 });
  });
});

describe('point conversion', () => {
  it('round-trips image ↔ canvas coordinates', () => {
    const g = getScreenshotGeometry(1600, 900, framed({ padding: 0.2 }));
    const image = { x: 320, y: 450 };
    const canvas = canvasPointFromImage(image, g);
    const back = imagePointFromCanvas(canvas, g);
    expect(back.x).toBeCloseTo(image.x);
    expect(back.y).toBeCloseTo(image.y);
  });

  it('maps an on-screen pointer to canvas pixels', () => {
    const rect = { left: 100, top: 50, width: 500, height: 250 };
    expect(clientToCanvasPoint(350, 175, rect, 2000, 1000)).toEqual({ x: 1000, y: 500 });
  });
});

type Call = { name: string; args: unknown[] };

const createRecordingContext = () => {
  const calls: Call[] = [];
  const props: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(props, {
    get(target, key) {
      if (key === 'measureText') {
        return (text: string) => ({ width: text.length * 10 });
      }
      if (key in target) {
        return target[key];
      }
      return (...args: unknown[]): unknown => {
        calls.push({ name: String(key), args });
        if (key === 'createLinearGradient') {
          return { addColorStop: (): void => undefined };
        }
        return undefined;
      };
    },
    set(target, key, value) {
      target[key] = value;
      calls.push({ name: `set:${String(key)}`, args: [value] });
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
};

const fakeImage = { width: 400, height: 200 } as unknown as CanvasImageSource;

describe('renderScreenshot', () => {
  it('draws background, then the image, then annotations', () => {
    const { ctx, calls } = createRecordingContext();
    const style = framed({ padding: 0.2 });
    const geometry = getScreenshotGeometry(400, 200, style);
    const box = must(
      createShapeFromDrag('box', { x: 10, y: 10 }, { x: 100, y: 100 }, 'box', {
        color: '#ff0000',
        scale: 1,
      }),
    );

    renderScreenshot(ctx, {
      image: fakeImage,
      imageWidth: 400,
      imageHeight: 200,
      style,
      geometry,
      shapes: [box],
    });

    const names = calls.map((c) => c.name);
    const bgFill = names.indexOf('fillRect');
    const imageDraw = calls.findIndex((c) => c.name === 'drawImage' && c.args[0] === fakeImage);
    const boxStroke = names.lastIndexOf('strokeRect');
    expect(bgFill).toBeGreaterThanOrEqual(0);
    expect(imageDraw).toBeGreaterThan(bgFill);
    expect(boxStroke).toBeGreaterThan(imageDraw);
  });

  it('skips the background when the frame is off', () => {
    const { ctx, calls } = createRecordingContext();
    const geometry = getScreenshotGeometry(400, 200, unframed);
    renderScreenshot(ctx, {
      image: fakeImage,
      imageWidth: 400,
      imageHeight: 200,
      style: unframed,
      geometry,
      shapes: [],
    });
    expect(calls.some((c) => c.name === 'fillRect')).toBe(false);
    expect(calls.some((c) => c.name === 'drawImage')).toBe(true);
  });

  it('re-draws the blurred region from the image before any other annotation', () => {
    const { ctx, calls } = createRecordingContext();
    const geometry = getScreenshotGeometry(400, 200, unframed);
    const step = createStepShape({ x: 50, y: 50 }, 'step', { color: '#f00', scale: 1 });
    const blur = must(
      createShapeFromDrag('blur', { x: 0, y: 0 }, { x: 100, y: 100 }, 'blur', {
        color: '#000',
        scale: 1,
      }),
    );

    renderScreenshot(ctx, {
      image: fakeImage,
      imageWidth: 400,
      imageHeight: 200,
      style: unframed,
      geometry,
      shapes: [step, blur],
    });

    const imageDraws = calls
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.name === 'drawImage' && c.args[0] === fakeImage);
    expect(imageDraws).toHaveLength(2);
    const blurFilter = calls.findIndex(
      (c) => c.name === 'set:filter' && String(c.args[0]).startsWith('blur('),
    );
    expect(blurFilter).toBeGreaterThan(imageDraws[0].i);
    expect(blurFilter).toBeLessThan(imageDraws[1].i);
    const stepText = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === '1');
    expect(stepText).toBeGreaterThan(imageDraws[1].i);
  });

  it('outlines the selected shape only when asked', () => {
    const { ctx, calls } = createRecordingContext();
    const geometry = getScreenshotGeometry(400, 200, unframed);
    const step = createStepShape({ x: 50, y: 50 }, 'step', { color: '#f00', scale: 1 });
    renderScreenshot(ctx, {
      image: fakeImage,
      imageWidth: 400,
      imageHeight: 200,
      style: unframed,
      geometry,
      shapes: [step],
      selectedId: 'step',
    });
    expect(calls.some((c) => c.name === 'setLineDash')).toBe(true);
  });
});
