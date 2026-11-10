import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../../store';
import { DEFAULT_FRAME } from '../frame/analyze';
import type { PixiScene } from '../../pixi/types';

import { logoPixiEffect } from './pixi';
import { preloadLogoImage } from './image';

const { images, FakeTexture } = vi.hoisted(() => {
  class FakeTexture {
    destroyed = false;
    constructor(readonly image: unknown) {}
    destroy() {
      this.destroyed = true;
    }
  }
  return {
    images: new Map<string, { complete: boolean; naturalWidth: number; naturalHeight: number }>(),
    FakeTexture,
  };
});
type FakeTexture = InstanceType<typeof FakeTexture>;

vi.mock('./image', () => ({
  getLogoImage: vi.fn((src: string) => images.get(src)),
  isLogoImageReady: (img: { complete: boolean; naturalWidth: number }) =>
    img.complete && img.naturalWidth > 0,
  preloadLogoImage: vi.fn(async () => undefined),
}));

vi.mock('pixi.js', () => ({
  Texture: {
    EMPTY: { empty: true },
    from: vi.fn((image: unknown) => new FakeTexture(image)),
  },
  Sprite: class {
    texture: unknown;
    visible = true;
    alpha = 1;
    width = 0;
    height = 0;
    eventMode = 'auto';
    position = {
      x: 0,
      y: 0,
      set: (x: number, y: number) => Object.assign(this.position, { x, y }),
    };
    constructor(texture?: unknown) {
      this.texture = texture;
    }
  },
}));

const A = 'data:image/png;base64,AA==';
const B = 'data:image/png;base64,BB==';

const fakeScene = () => {
  const children: unknown[] = [];
  return {
    scene: {
      app: { renderer: { width: 1920, height: 1080 }, stage: { x: 0, y: 0 } },
      overlayContainer: { addChild: (child: unknown) => children.push(child) },
    } as unknown as PixiScene,
    children,
  };
};

type FakeSprite = {
  texture: unknown;
  visible: boolean;
  alpha: number;
  width: number;
  height: number;
  position: { x: number; y: number };
};

describe('logo effect (Pixi)', () => {
  const initialFrame = useStore.getState().frame;
  afterEach(() => {
    useStore.setState({ frame: initialFrame });
    images.clear();
  });

  const setup = async () => {
    const { scene, children } = fakeScene();
    const update = await logoPixiEffect.setup?.(null, new Map(), scene);
    const sprite = children[0] as FakeSprite;
    const tick = () => (update as (t: number, dt: number, rc: object) => void)(0, 0, {});
    return { sprite, tick };
  };

  it('hides the sprite when the project has no logo', async () => {
    useStore.setState({ frame: DEFAULT_FRAME });
    const { sprite, tick } = await setup();
    tick();
    expect(sprite.visible).toBe(false);
  });

  it('waits for the logo image before export frames start', async () => {
    images.set(A, { complete: true, naturalWidth: 100, naturalHeight: 50 });
    useStore.setState({
      frame: { ...DEFAULT_FRAME, logo: { src: A, corner: 'bottom-right', size: 0.1, opacity: 80 } },
    });
    await setup();
    expect(preloadLogoImage).toHaveBeenCalledWith(A);
  });

  it('places the logo like the preview does', async () => {
    images.set(A, { complete: true, naturalWidth: 100, naturalHeight: 50 });
    useStore.setState({
      frame: { ...DEFAULT_FRAME, logo: { src: A, corner: 'bottom-right', size: 0.1, opacity: 80 } },
    });
    const { sprite, tick } = await setup();
    tick();
    const margin = Math.round(1080 * 0.04);
    expect(sprite.visible).toBe(true);
    expect(sprite.alpha).toBeCloseTo(0.8);
    expect(sprite.width).toBeCloseTo(192);
    expect(sprite.height).toBeCloseTo(96);
    expect(sprite.position.x).toBeCloseTo(1920 - margin - 192);
    expect(sprite.position.y).toBeCloseTo(1080 - margin - 96);
  });

  it('swaps the texture when the logo changes, and hides it until the new image loads', async () => {
    images.set(A, { complete: true, naturalWidth: 100, naturalHeight: 100 });
    images.set(B, { complete: false, naturalWidth: 0, naturalHeight: 0 });
    useStore.setState({
      frame: { ...DEFAULT_FRAME, logo: { src: A, corner: 'top-left', size: 0.1, opacity: 100 } },
    });
    const { sprite, tick } = await setup();
    tick();
    const first = sprite.texture as FakeTexture;

    useStore.setState({
      frame: { ...DEFAULT_FRAME, logo: { src: B, corner: 'top-left', size: 0.1, opacity: 100 } },
    });
    tick();
    expect(sprite.visible).toBe(false);

    images.set(B, { complete: true, naturalWidth: 100, naturalHeight: 100 });
    tick();
    expect(sprite.visible).toBe(true);
    expect((sprite.texture as FakeTexture).image).toBe(images.get(B));
    expect(first.destroyed).toBe(true);
  });
});
