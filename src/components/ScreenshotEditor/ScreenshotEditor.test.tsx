import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenshotCapture, StylePreset } from 'src/types';
import { ScreenshotEditor } from './ScreenshotEditor';

vi.mock('src/lib/analytics', () => ({ trackEvent: vi.fn() }));

// WebGL is not available in jsdom; a stand-in renderer records what the editor asks of it.
const studio = vi.hoisted(() => ({
  fail: false,
  /** Where the fake renderer says a screenshot point lands on the canvas (fractions). */
  project: null as { x: number; y: number } | null,
  instances: [] as {
    settings: { lean: number; dof: boolean };
    setFocus: ReturnType<typeof vi.fn>;
    setLightPower: ReturnType<typeof vi.fn>;
    setBlurAmount: ReturnType<typeof vi.fn>;
    setLightSize: ReturnType<typeof vi.fn>;
    setBackdrop: ReturnType<typeof vi.fn>;
    setFrame: ReturnType<typeof vi.fn>;
    start: () => void;
    renderStill: (w: number, h: number) => HTMLCanvasElement;
    setScreen: (...args: unknown[]) => void;
    setSettings: (...args: unknown[]) => void;
    pickImagePoint: ReturnType<typeof vi.fn>;
    projectImagePoint: ReturnType<typeof vi.fn>;
    setOffset: ReturnType<typeof vi.fn>;
    setView: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('src/lib/screenshot/studio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('src/lib/screenshot/studio')>();
  class FakeStudioRenderer {
    start = vi.fn();
    dispose = vi.fn();
    resize = vi.fn();
    setScreen = vi.fn();
    setSettings = vi.fn();
    setOffset = vi.fn();
    setLightHandle = vi.fn();
    maxDepth = vi.fn(() => 0.85);
    setView = vi.fn();
    minZoom = vi.fn(() => 0.35);
    setFocus = vi.fn();
    setLightPower = vi.fn();
    setBlurAmount = vi.fn();
    setLightSize = vi.fn();
    setBackdrop = vi.fn();
    setFrame = vi.fn();
    getFocusPoint = vi.fn(() => ({ x: 400, y: 300 }));
    pickImagePoint = vi.fn((): { x: number; y: number } | null => null);
    projectImagePoint = vi.fn(() => studio.project);
    settings: { lean: number; dof: boolean };
    renderStill = vi.fn((width: number, height: number) =>
      Object.assign(document.createElement('canvas'), { width, height }),
    );
    constructor(_canvas: HTMLCanvasElement, settings: { lean: number; dof: boolean }) {
      if (studio.fail) {
        throw new Error('Studio looks need WebGL 2');
      }
      this.settings = settings;
      studio.instances.push(this);
    }
  }
  return { ...actual, StudioRenderer: FakeStudioRenderer };
});

vi.mock('src/lib/effects/frame', async (importOriginal) => {
  const actual = await importOriginal<typeof import('src/lib/effects/frame')>();
  return {
    ...actual,
    preloadWallpapersAsync: () => Promise.resolve(),
    preloadCustomWallpaperAsync: () => Promise.resolve(),
  };
});

const capture: ScreenshotCapture = {
  kind: 'area',
  imageUrl: 'blob:screenforge/source',
  width: 800,
  height: 600,
};

const OUTPUT = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const noopContext = () =>
  new Proxy(
    {},
    {
      get: (_target, key): unknown =>
        key === 'measureText'
          ? () => ({ width: 10 })
          : key === 'createLinearGradient'
            ? () => ({ addColorStop: (): void => undefined })
            : (): void => undefined,
      set: () => true,
    },
  );

class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  private _src = '';
  addEventListener() {
    // wallpapers are preloaded through the mocked helpers above
  }
  removeEventListener() {
    // see addEventListener
  }
  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      this.complete = true;
      this.naturalWidth = 800;
      this.naturalHeight = 600;
      this.onload?.();
    });
  }
}

const presets: StylePreset[] = [];

beforeEach(() => {
  // The tests outside 'studio' cover the flat frame: the editor's fallback without WebGL 2.
  studio.fail = true;
  studio.project = null;
  studio.instances.length = 0;
  vi.stubGlobal('Image', LoadingImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() =>
    noopContext()) as unknown as HTMLCanvasElement['getContext']);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) =>
    cb(new Blob([OUTPUT], { type: 'image/png' })),
  );
  window.screenforge = {
    saveScreenshot: vi.fn().mockResolvedValue('/Users/me/Pictures/Screenforge/shot.png'),
    copyScreenshotToClipboard: vi.fn().mockResolvedValue(undefined),
    getPresets: vi.fn().mockResolvedValue(presets),
    revealExportInFolder: vi.fn(),
  } as unknown as typeof window.screenforge;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const renderEditor = async (onClose = vi.fn()) => {
  render(<ScreenshotEditor capture={capture} onClose={onClose} />);
  // Let the image "load".
  await act(async () => {
    await Promise.resolve();
  });
  return { onClose };
};

describe('ScreenshotEditor', () => {
  describe('studio', () => {
    beforeEach(() => {
      studio.fail = false;
    });

    // jsdom lays nothing out: give every element (the stage too) a real size.
    const withLayout = () =>
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 848,
        height: 548,
        right: 848,
        bottom: 548,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    const studioCanvas = () => {
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 800,
        height: 500,
        right: 800,
        bottom: 500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      canvas.setPointerCapture = vi.fn();
      return canvas;
    };
    const press = (el: Element, x: number, y: number) =>
      fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: x, clientY: y });
    const release = (el: Element, x: number, y: number) =>
      fireEvent.pointerUp(el, { button: 0, pointerId: 1, clientX: x, clientY: y });
    const drag = (canvas: HTMLCanvasElement, from: [number, number], to: [number, number]) => {
      press(canvas, ...from);
      fireEvent.pointerMove(canvas, { button: 0, pointerId: 1, clientX: to[0], clientY: to[1] });
      release(canvas, ...to);
    };
    const opened = async () => {
      await renderEditor();
      await waitFor(() => expect(studio.instances).toHaveLength(1));
      return studio.instances[0];
    };

    it('opens every screenshot through the macro lens, 16:9 with square corners', async () => {
      studio.project = { x: 0.5, y: 0.5 };
      const renderer = await opened();
      // Straight-on to start: no lean, depth of field ready for when the camera turns.
      expect(renderer.settings.lean).toBe(0);
      expect(renderer.settings.dof).toBe(true);
      expect(renderer.start).toHaveBeenCalled();
      // No looks to pick: the sidebar is the frame and the background.
      expect(screen.queryByRole('button', { name: /macro/i })).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /aspect ratio/i })).toHaveTextContent('16:9');
      expect(renderer.setFrame).toHaveBeenLastCalledWith(expect.objectContaining({ radiusPx: 0 }));
      expect(renderer.setBackdrop).toHaveBeenCalled();
      expect(screen.getByText(/click to focus/i)).toBeInTheDocument();
      // The handles introduce themselves.
      expect(screen.getByText('Focus')).toBeInTheDocument();
      expect(screen.getByText('Light')).toBeInTheDocument();
    });

    it('paints the chosen background behind the screenshot', async () => {
      const user = userEvent.setup();
      const renderer = await opened();
      await user.click(screen.getByRole('radio', { name: /^solid$/i }));
      await waitFor(() =>
        expect(renderer.setBackdrop).toHaveBeenLastCalledWith(
          expect.objectContaining({ kind: 'solid' }),
        ),
      );
      await user.click(screen.getByRole('radio', { name: /^wallpaper$/i }));
      await waitFor(() =>
        expect(renderer.setBackdrop).toHaveBeenLastCalledWith(
          expect.objectContaining({ kind: 'image' }),
        ),
      );
    });

    it('hovering the focus ring offers a wider sharp area and more or less blur', async () => {
      studio.project = { x: 0.5, y: 0.5 };
      const user = userEvent.setup();
      const renderer = await opened();
      await user.hover(await screen.findByRole('button', { name: /focus point/i }));
      await user.hover(screen.getByRole('button', { name: /wider sharp area/i }));
      // The option says what it does.
      expect(screen.getAllByText('Wider sharp area').length).toBeGreaterThan(0);
      await user.click(screen.getByRole('button', { name: /wider sharp area/i }));
      await waitFor(() => expect(renderer.setFocus.mock.calls.at(-1)?.[2]).toBeCloseTo(0.1, 5));
      await user.click(screen.getByRole('button', { name: /less blur/i }));
      await waitFor(() =>
        expect(renderer.setBlurAmount.mock.calls.at(-1)?.[0]).toBeCloseTo(0.7, 5),
      );
      expect(screen.getByText('Blur 70%')).toBeInTheDocument();
    });

    it('hovering the light offers brighter or dimmer, and softer or crisper shadows', async () => {
      const user = userEvent.setup();
      const renderer = await opened();
      await user.hover(screen.getByRole('button', { name: /^light$/i }));
      await user.click(screen.getByRole('button', { name: /^brighter$/i }));
      await waitFor(() =>
        expect(renderer.setLightPower.mock.calls.at(-1)?.[0]).toBeCloseTo(1.15, 5),
      );
      await user.click(screen.getByRole('button', { name: /softer shadows/i }));
      await waitFor(() =>
        expect(renderer.setLightSize.mock.calls.at(-1)?.[0]).toBeCloseTo(0.65, 5),
      );
      // One Undo takes the softness back to the look's own.
      await user.click(screen.getByRole('button', { name: /^undo$/i }));
      await waitFor(() => expect(renderer.setLightSize.mock.calls.at(-1)?.[0]).toBeNull());
    });

    it('exports the finished studio still', async () => {
      const user = userEvent.setup();
      const renderer = await opened();
      await waitFor(() => expect(renderer.setScreen).toHaveBeenCalled());
      await user.click(screen.getByRole('button', { name: /^copy$/i }));
      await waitFor(() => expect(window.screenforge.copyScreenshotToClipboard).toHaveBeenCalled());
      expect(renderer.renderStill).toHaveBeenCalled();
    });

    it('focuses where the screenshot is clicked, and Alt-click focuses with any tool', async () => {
      const user = userEvent.setup();
      const renderer = await opened();
      const canvas = studioCanvas();
      const lastFocus = () => renderer.setFocus.mock.calls.at(-1)?.[0];
      renderer.pickImagePoint.mockReturnValue({ x: 100, y: 80 });
      press(canvas, 200, 150);
      release(canvas, 200, 150);
      await waitFor(() => expect(lastFocus()).toEqual({ x: 100, y: 80 }));
      // A click with a drawing tool draws nothing, so it focuses too.
      await user.click(screen.getByRole('button', { name: /^arrow$/i }));
      renderer.pickImagePoint.mockReturnValue({ x: 300, y: 200 });
      press(canvas, 300, 200);
      release(canvas, 300, 200);
      await waitFor(() => expect(lastFocus()).toEqual({ x: 300, y: 200 }));
      renderer.pickImagePoint.mockReturnValue({ x: 50, y: 40 });
      fireEvent.pointerDown(canvas, {
        button: 0,
        pointerId: 1,
        clientX: 50,
        clientY: 40,
        altKey: true,
      });
      await waitFor(() => expect(lastFocus()).toEqual({ x: 50, y: 40 }));
    });

    it('widens the sharp area on scroll over the focus ring, with a readout', async () => {
      studio.project = { x: 0.5, y: 0.5 };
      const renderer = await opened();
      const ring = await screen.findByRole('button', { name: /focus point/i });
      fireEvent.wheel(ring, { deltaY: -100 });
      fireEvent.wheel(ring, { deltaY: -100 });
      await waitFor(() => expect(renderer.setFocus.mock.calls.at(-1)?.[2]).toBeCloseTo(0.2, 5));
      expect(screen.getByText('Sharp area 20%')).toBeInTheDocument();
    });

    it('brightens the light on scroll over the sun, and a double-click resets it', async () => {
      const renderer = await opened();
      const sun = screen.getByRole('button', { name: /^light$/i });
      fireEvent.wheel(sun, { deltaY: -100 });
      await waitFor(() => expect(renderer.setLightPower.mock.calls.at(-1)?.[0]).toBeGreaterThan(1));
      expect(screen.getByText(/^Light \d+%$/)).toBeInTheDocument();
      fireEvent.doubleClick(sun);
      await waitFor(() => expect(renderer.setLightPower.mock.calls.at(-1)?.[0]).toBe(1));
    });

    it('a plain click on the sun changes nothing and adds no undo step', async () => {
      withLayout();
      await opened();
      const sun = screen.getByRole('button', { name: /^light$/i });
      sun.setPointerCapture = vi.fn();
      press(sun, 10, 10);
      release(sun, 10, 10);
      expect(screen.getByRole('button', { name: /^undo$/i })).toBeDisabled();
    });

    it('turns the camera on a drag, zooms on scroll, and a double-click on empty space resets it', async () => {
      withLayout();
      const renderer = await opened();
      const canvas = studioCanvas();
      const lastView = () =>
        renderer.setView.mock.calls.at(-1) as [{ x: number; y: number }, number];
      drag(canvas, [100, 100], [300, 100]);
      await waitFor(() => expect(lastView()[0].x).toBeLessThan(0));
      // The screenshot itself stays where it was.
      expect(renderer.setOffset.mock.calls.at(-1)?.[0]).toEqual({ x: 0, y: 0 });
      fireEvent.wheel(canvas, { deltaY: -100 });
      await waitFor(() => expect(lastView()[1]).toBeLessThan(1));
      fireEvent.doubleClick(canvas, { clientX: 5, clientY: 5 });
      await waitFor(() => expect(lastView()).toEqual([{ x: 0, y: 0 }, 1]));
    });

    it('moves the screenshot with Space + drag', async () => {
      withLayout();
      const renderer = await opened();
      const canvas = studioCanvas();
      fireEvent.keyDown(window, { code: 'Space', key: ' ' });
      drag(canvas, [400, 250], [600, 250]);
      fireEvent.keyUp(window, { code: 'Space', key: ' ' });
      await waitFor(() => expect(renderer.setOffset.mock.calls.at(-1)?.[0].x).toBeGreaterThan(0.2));
      expect(renderer.setOffset.mock.calls.at(-1)?.[0].y).toBe(0);
      // The camera did not turn.
      expect(renderer.setView.mock.calls.at(-1)?.[0]).toEqual({ x: 0, y: 0 });
    });

    it('moves the screenshot in depth with Space + scroll, as one undo step', async () => {
      const user = userEvent.setup();
      const renderer = await opened();
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      const lastDepth = () => renderer.setOffset.mock.calls.at(-1)?.[1] as number;
      fireEvent.keyDown(window, { code: 'Space', key: ' ' });
      fireEvent.wheel(canvas, { deltaY: -100 });
      fireEvent.wheel(canvas, { deltaY: -100 });
      await waitFor(() => expect(lastDepth()).toBeGreaterThan(0.2));
      fireEvent.wheel(canvas, { deltaY: 600 });
      await waitFor(() => expect(lastDepth()).toBeLessThan(0));
      fireEvent.keyUp(window, { code: 'Space', key: ' ' });
      await user.click(screen.getByRole('button', { name: /^undo$/i }));
      await waitFor(() => expect(lastDepth()).toBe(0));
      expect(screen.getByRole('button', { name: /^undo$/i })).toBeDisabled();
    });

    it('maps the pointer through the tilted screen in capture pixels, even past the size cap', async () => {
      // 16384 px wide: the studio's screen canvas is capped at 8192, half the capture's size.
      const big: ScreenshotCapture = { ...capture, width: 16384, height: 8192 };
      const user = userEvent.setup();
      render(<ScreenshotEditor capture={big} onClose={vi.fn()} />);
      await act(async () => {
        await Promise.resolve();
      });
      await waitFor(() => expect(studio.instances).toHaveLength(1));
      const renderer = studio.instances[0];
      renderer.pickImagePoint.mockReturnValue({ x: 4096, y: 2048 });
      const canvas = studioCanvas();
      await user.click(screen.getByRole('button', { name: /^text$/i }));
      press(canvas, 400, 250);
      // The text box is placed at capture pixel (8192, 4096) and shown where that lands on the screen.
      await waitFor(() => expect(renderer.projectImagePoint).toHaveBeenCalledWith(4096, 2048));
      // 100 capture pixels to the right is 50 on the half-size screen: tells the two spaces apart.
      expect(renderer.projectImagePoint).toHaveBeenCalledWith(4146, 2048);
      expect(renderer.pickImagePoint).toHaveBeenCalledWith(0.5, 0.5);
    });

    it('draws an annotation straight onto the studio screen', async () => {
      const user = userEvent.setup();
      const renderer = await opened();
      const canvas = studioCanvas();
      await user.click(screen.getByRole('button', { name: /^box$/i }));
      renderer.pickImagePoint.mockReturnValue({ x: 100, y: 100 });
      press(canvas, 200, 200);
      renderer.pickImagePoint.mockReturnValue({ x: 400, y: 300 });
      fireEvent.pointerMove(canvas, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
      release(canvas, 400, 300);
      // The new box is selected, so it can be deleted, and it is undoable.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /delete annotation/i })).toBeEnabled(),
      );
      expect(screen.getByRole('button', { name: /^undo$/i })).toBeEnabled();
    });

    it('falls back to the flat frame, with its style panel, when the studio cannot start', async () => {
      studio.fail = true;
      const user = userEvent.setup();
      const { container } = render(<ScreenshotEditor capture={capture} onClose={vi.fn()} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(container.querySelector('canvas')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /macro/i })).not.toBeInTheDocument();
      expect(screen.getByRole('switch', { name: /^frame$/i })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^copy$/i }));
      await waitFor(() =>
        expect(window.screenforge.copyScreenshotToClipboard).toHaveBeenCalledWith(OUTPUT),
      );
    });
  });

  it('offers every annotation tool', async () => {
    await renderEditor();
    for (const name of [
      /select and move/i,
      /^arrow$/i,
      /^box$/i,
      /^highlight$/i,
      /^blur$/i,
      /^text$/i,
      /numbered step/i,
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks the active tool', async () => {
    const user = userEvent.setup();
    await renderEditor();
    await user.click(screen.getByRole('button', { name: /^box$/i }));
    expect(screen.getByRole('button', { name: /^box$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^arrow$/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('copies the rendered PNG to the clipboard', async () => {
    const user = userEvent.setup();
    await renderEditor();
    await user.click(screen.getByRole('button', { name: /^copy$/i }));
    await waitFor(() =>
      expect(window.screenforge.copyScreenshotToClipboard).toHaveBeenCalledWith(OUTPUT),
    );
  });

  it('does not export while a blur is still being drawn, only once it is placed', async () => {
    const user = userEvent.setup();
    const { container } = render(<ScreenshotEditor capture={capture} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: canvas.width,
      height: canvas.height,
      right: canvas.width,
      bottom: canvas.height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    await user.click(screen.getByRole('button', { name: /^blur$/i }));

    const at = (x: number, y: number) => ({ button: 0, pointerId: 1, clientX: x, clientY: y });
    fireEvent.pointerDown(canvas, at(canvas.width * 0.3, canvas.height * 0.3));
    fireEvent.pointerMove(canvas, at(canvas.width * 0.6, canvas.height * 0.6));
    // The preview already shows the blur; an export now would not have it.
    await user.keyboard('{Control>}c{/Control}');
    await user.keyboard('{Meta>}c{/Meta}');
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeDisabled();
    expect(window.screenforge.copyScreenshotToClipboard).not.toHaveBeenCalled();

    fireEvent.pointerUp(canvas, at(canvas.width * 0.6, canvas.height * 0.6));
    await user.click(screen.getByRole('button', { name: /^copy$/i }));
    await waitFor(() => expect(window.screenforge.copyScreenshotToClipboard).toHaveBeenCalled());
  });

  it('saves the rendered PNG', async () => {
    const user = userEvent.setup();
    await renderEditor();
    await user.click(screen.getByRole('button', { name: /save png/i }));
    await waitFor(() => expect(window.screenforge.saveScreenshot).toHaveBeenCalledWith(OUTPUT));
  });

  it('closes from the close button', async () => {
    const user = userEvent.setup();
    const { onClose } = await renderEditor();
    await user.click(screen.getByRole('button', { name: /close screenshot/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('undoes and redoes a style change from the keyboard', async () => {
    const user = userEvent.setup();
    await renderEditor();
    const frame = screen.getByRole('switch', { name: /frame/i });
    expect(frame).toHaveAttribute('aria-checked', 'true');
    await user.click(frame);
    expect(frame).toHaveAttribute('aria-checked', 'false');
    await user.keyboard('{Control>}z{/Control}');
    expect(frame).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(frame).toHaveAttribute('aria-checked', 'false');
  });

  it('loads saved style presets', async () => {
    await renderEditor();
    expect(window.screenforge.getPresets).toHaveBeenCalled();
  });
});
