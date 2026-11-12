import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenshotCapture, StylePreset } from 'src/types';
import { ScreenshotEditor } from './ScreenshotEditor';

vi.mock('src/lib/analytics', () => ({ trackEvent: vi.fn() }));

// WebGL is not available in jsdom; a stand-in renderer records what the editor asks of it.
const studio = vi.hoisted(() => ({
  fail: false,
  instances: [] as {
    start: () => void;
    renderStill: (w: number, h: number) => HTMLCanvasElement;
    setScreen: (...args: unknown[]) => void;
    setSettings: (...args: unknown[]) => void;
    pickImagePoint: ReturnType<typeof vi.fn>;
    projectImagePoint: ReturnType<typeof vi.fn>;
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
    pickImagePoint = vi.fn(() => null);
    projectImagePoint = vi.fn(() => null);
    renderStill = vi.fn((width: number, height: number) =>
      Object.assign(document.createElement('canvas'), { width, height }),
    );
    constructor() {
      if (studio.fail) {
        throw new Error('Studio looks need WebGL 2');
      }
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
  dataUrl: 'data:image/png;base64,SOURCE',
  width: 800,
  height: 600,
};

const OUTPUT = 'data:image/png;base64,OUTPUT';

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
  vi.stubGlobal('Image', LoadingImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() =>
    noopContext()) as unknown as HTMLCanvasElement['getContext']);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(OUTPUT);
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
  describe('studio looks', () => {
    beforeEach(() => {
      studio.fail = false;
      studio.instances.length = 0;
    });

    it('starts flat, with the looks offered beside it', async () => {
      await renderEditor();
      expect(screen.getByRole('button', { name: /^flat$/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('button', { name: /macro/i })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(studio.instances).toHaveLength(0);
    });

    it('renders a picked look in the studio and exports the studio still', async () => {
      const user = userEvent.setup();
      await renderEditor();
      await user.click(screen.getByRole('button', { name: /night glow/i }));
      await waitFor(() => expect(studio.instances).toHaveLength(1));
      const renderer = studio.instances[0];
      expect(renderer.start).toHaveBeenCalled();
      await waitFor(() => expect(renderer.setScreen).toHaveBeenCalled());
      // The flat frame's own controls give way to the look.
      expect(screen.queryByRole('switch', { name: /^frame$/i })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /^copy$/i }));
      await waitFor(() => expect(window.screenforge.copyScreenshotToClipboard).toHaveBeenCalled());
      expect(renderer.renderStill).toHaveBeenCalled();
    });

    it('switches looks on the same renderer', async () => {
      const user = userEvent.setup();
      await renderEditor();
      await user.click(screen.getByRole('button', { name: /night glow/i }));
      await waitFor(() => expect(studio.instances).toHaveLength(1));
      await user.click(screen.getByRole('button', { name: /macro/i }));
      await waitFor(() => expect(studio.instances[0].setSettings).toHaveBeenCalled());
      expect(studio.instances).toHaveLength(1);
    });

    it('stays usable on the flat frame when the studio cannot start', async () => {
      studio.fail = true;
      const user = userEvent.setup();
      const { container } = render(<ScreenshotEditor capture={capture} onClose={vi.fn()} />);
      await act(async () => {
        await Promise.resolve();
      });
      await user.click(screen.getByRole('button', { name: /night glow/i }));
      expect(container.querySelector('canvas')).toBeInTheDocument();
      // The panel shows what is really on screen, and the looks cannot be picked here.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^flat$/i })).toHaveAttribute(
          'aria-pressed',
          'true',
        ),
      );
      expect(screen.getByRole('button', { name: /night glow/i })).toBeDisabled();
      // Undo and redo cannot bring the failed look back into the panel.
      await user.click(screen.getByRole('button', { name: /^undo$/i }));
      await user.click(screen.getByRole('button', { name: /^redo$/i }));
      expect(screen.getByRole('button', { name: /^flat$/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('switch', { name: /^frame$/i })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /^copy$/i }));
      await waitFor(() =>
        expect(window.screenforge.copyScreenshotToClipboard).toHaveBeenCalledWith(OUTPUT),
      );
    });

    it('maps the pointer through the tilted screen in capture pixels, even past the size cap', async () => {
      // 16384 px wide: the studio's screen canvas is capped at 8192, half the capture's size.
      const big: ScreenshotCapture = { ...capture, width: 16384, height: 8192 };
      const user = userEvent.setup();
      const { container } = render(<ScreenshotEditor capture={big} onClose={vi.fn()} />);
      await act(async () => {
        await Promise.resolve();
      });
      await user.click(screen.getByRole('button', { name: /night glow/i }));
      await waitFor(() => expect(studio.instances).toHaveLength(1));
      const renderer = studio.instances[0];
      renderer.pickImagePoint.mockReturnValue({ x: 4096, y: 2048 });
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
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
      await user.click(screen.getByRole('button', { name: /^text$/i }));
      fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 400, clientY: 250 });
      // The text box is placed at capture pixel (8192, 4096) and shown where that lands on the screen.
      await waitFor(() => expect(renderer.projectImagePoint).toHaveBeenCalledWith(4096, 2048));
      // 100 capture pixels to the right is 50 on the half-size screen: tells the two spaces apart.
      expect(renderer.projectImagePoint).toHaveBeenCalledWith(4146, 2048);
      expect(renderer.pickImagePoint).toHaveBeenCalledWith(0.5, 0.5);
    });

    it('draws an annotation straight onto the studio screen', async () => {
      const user = userEvent.setup();
      const { container } = render(<ScreenshotEditor capture={capture} onClose={vi.fn()} />);
      await act(async () => {
        await Promise.resolve();
      });
      await user.click(screen.getByRole('button', { name: /night glow/i }));
      await waitFor(() => expect(studio.instances).toHaveLength(1));
      const renderer = studio.instances[0];
      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
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
      await user.click(screen.getByRole('button', { name: /^box$/i }));
      renderer.pickImagePoint.mockReturnValue({ x: 100, y: 100 });
      fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 200, clientY: 200 });
      renderer.pickImagePoint.mockReturnValue({ x: 400, y: 300 });
      fireEvent.pointerMove(canvas, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
      fireEvent.pointerUp(canvas, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
      // The new box is selected, so it can be deleted, and it is undoable.
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /delete annotation/i })).toBeEnabled(),
      );
      expect(screen.getByRole('button', { name: /^undo$/i })).toBeEnabled();
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
