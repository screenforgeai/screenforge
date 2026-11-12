import { Sprite, Texture } from 'pixi.js';

/**
 * A sprite showing a 2D canvas that is redrawn every frame (the cursor effects
 * layer). When the size changes it gets a brand-new canvas and texture: resizing
 * a canvas texture in place leaves Pixi's GPU texture at its old size, so the
 * drawing showed up shrunk into a corner once the preview resized to the
 * recording's real dimensions.
 */
export function createCanvasLayer() {
  let canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  // skipCache: every canvas would share Pixi's cache key "[object HTMLCanvasElement]".
  const sprite = new Sprite(Texture.from(canvas, true));
  sprite.eventMode = 'none';

  return {
    sprite,
    /** A cleared 2D context for a canvas of exactly `width` × `height` pixels. */
    prepare(width: number, height: number): CanvasRenderingContext2D | null {
      if (canvas.width !== width || canvas.height !== height) {
        const previous = sprite.texture;
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        sprite.texture = Texture.from(canvas, true);
        previous.destroy(true);
      }
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);
      }
      return ctx;
    },
    /** Sends this frame's drawing to the GPU. */
    upload() {
      sprite.texture.source.update();
    },
  };
}
