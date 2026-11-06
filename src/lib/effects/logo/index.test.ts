import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../../store';
import { DEFAULT_FRAME } from '../frame/analyze';

import { logoEffect } from './index';

const { image } = vi.hoisted(() => ({
  image: { complete: true, naturalWidth: 200, naturalHeight: 100 },
}));
vi.mock('./image', () => ({
  getLogoImage: vi.fn(() => image),
  isLogoImageReady: (img: typeof image) => img.complete && img.naturalWidth > 0,
}));

const LOGO = {
  src: 'data:image/png;base64,AA==',
  corner: 'top-left' as const,
  size: 0.1,
  opacity: 50,
};

const fakeContext = () => {
  const calls: unknown[][] = [];
  const ctx: { globalAlpha: number; save: () => void; restore: () => void; drawImage: () => void } =
    {
      globalAlpha: 1,
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn((...args: unknown[]) => {
        calls.push([...args, ctx.globalAlpha]);
      }),
    };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx };
};

describe('logo effect (Canvas 2D)', () => {
  const initialFrame = useStore.getState().frame;
  afterEach(() => useStore.setState({ frame: initialFrame }));

  const draw = () => {
    const layer = logoEffect.createLayer?.(null);
    const { ctx, calls, raw } = fakeContext();
    layer?.draw(ctx, 0, 1920, 1080, 1920, 1080);
    return { layer, calls, raw };
  };

  it('is an overlay, drawn after everything else', () => {
    expect(logoEffect.createLayer?.(null).phase).toBe('overlay');
  });

  it('draws nothing for a project without a logo', () => {
    useStore.setState({ frame: DEFAULT_FRAME });
    expect(draw().calls).toEqual([]);
  });

  it('draws the logo in its corner at its opacity', () => {
    useStore.setState({ frame: { ...DEFAULT_FRAME, logo: LOGO } });
    const { calls, raw } = draw();
    const margin = Math.round(1080 * 0.04);
    expect(calls).toEqual([[image, margin, margin, 192, 96, 0.5]]);
    expect(raw.save).toHaveBeenCalled();
    expect(raw.restore).toHaveBeenCalled();
  });

  it('waits for the image to load', () => {
    useStore.setState({ frame: { ...DEFAULT_FRAME, logo: LOGO } });
    image.complete = false;
    try {
      expect(draw().calls).toEqual([]);
    } finally {
      image.complete = true;
    }
  });
});
