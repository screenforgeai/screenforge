import { useStore } from '../../../store';
import type { Effect } from '../types';
import { getLogoImage, isLogoImageReady } from './image';
import { computeLogoRect } from './layout';

export * from './layout';

/**
 * A logo in a corner of the video (from a style preset, e.g. the Director
 * brand kit). Drawn as an overlay, over the framed video and its background.
 */
export const logoEffect: Effect<null> = {
  id: 'logo',

  analyze() {
    return null;
  },

  createLayer() {
    return {
      phase: 'overlay' as const,
      draw(ctx, _t, _sw, _sh, canvasWidth, canvasHeight) {
        const { logo } = useStore.getState().frame;
        if (!logo) {
          return;
        }
        const image = getLogoImage(logo.src);
        if (!isLogoImageReady(image)) {
          return;
        }
        const rect = computeLogoRect(
          canvasWidth,
          canvasHeight,
          image.naturalWidth,
          image.naturalHeight,
          logo,
        );
        ctx.save();
        ctx.globalAlpha = logo.opacity / 100;
        ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
      },
    };
  },
};
