import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenshotCapture, StylePreset } from 'src/types';
import { ScreenshotEditor } from './ScreenshotEditor';

vi.mock('src/lib/analytics', () => ({ trackEvent: vi.fn() }));

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

  it('loads saved style presets', async () => {
    await renderEditor();
    expect(window.screenforge.getPresets).toHaveBeenCalled();
  });
});
