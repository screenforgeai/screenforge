import { Sprite, Texture } from 'pixi.js';
import { useStore } from '../../../store';
import type { PixiEffect, PixiEffectUpdater } from '../../pixi/types';
import { getLogoImage, isLogoImageReady, preloadLogoImage } from './image';
import { computeLogoRect } from './layout';

/**
 * The corner logo for the Pixi preview and export. Lives in the overlay
 * container, so it isn't zoomed or moved with the recording, and text,
 * captions and the camera draw over it.
 */
export const logoPixiEffect: PixiEffect<null> = {
  id: 'logo',

  analyze() {
    return null;
  },

  async setup(_data, _allData, scene): Promise<PixiEffectUpdater> {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.eventMode = 'none';
    sprite.visible = false;
    scene.overlayContainer.addChild(sprite);

    // Export renders frames back to back: have the image ready for frame one.
    const initial = useStore.getState().frame.logo;
    if (initial) {
      await preloadLogoImage(initial.src);
    }

    let textureSrc: string | null = null;
    let texture: Texture | null = null;

    return () => {
      const { logo } = useStore.getState().frame;
      if (!logo) {
        sprite.visible = false;
        return;
      }
      const image = getLogoImage(logo.src);
      if (!isLogoImageReady(image)) {
        sprite.visible = false;
        return;
      }
      if (textureSrc !== logo.src) {
        const previous = texture;
        texture = Texture.from(image);
        textureSrc = logo.src;
        sprite.texture = texture;
        previous?.destroy(true);
      }

      const canvasWidth = scene.app.renderer.width - 2 * scene.app.stage.x;
      const canvasHeight = scene.app.renderer.height - 2 * scene.app.stage.y;
      const rect = computeLogoRect(
        canvasWidth,
        canvasHeight,
        image.naturalWidth,
        image.naturalHeight,
        logo,
      );
      sprite.position.set(rect.x, rect.y);
      sprite.width = rect.width;
      sprite.height = rect.height;
      sprite.alpha = logo.opacity / 100;
      sprite.visible = true;
    };
  },
};
