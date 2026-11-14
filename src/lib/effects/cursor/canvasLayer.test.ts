import { describe, expect, it } from 'vitest';
import { createCanvasLayer } from './canvasLayer';

describe('canvas layer', () => {
  it('keeps the same texture while the size stays the same', () => {
    const layer = createCanvasLayer();
    layer.prepare(320, 180);
    const texture = layer.sprite.texture;
    layer.prepare(320, 180);
    expect(layer.sprite.texture).toBe(texture);
  });

  it('swaps in a new texture of the new size when the size changes, and frees the old one', () => {
    // Resizing a canvas texture in place leaves Pixi's GPU texture at its old size,
    // so the layer drew into a corner after the preview resized to the recording.
    const layer = createCanvasLayer();
    layer.prepare(1280, 800);
    const before = layer.sprite.texture;

    layer.prepare(1791, 1080);

    expect(layer.sprite.texture).not.toBe(before);
    expect(before.destroyed).toBe(true);
    expect(layer.sprite.texture.source.pixelWidth).toBe(1791);
    expect(layer.sprite.texture.source.pixelHeight).toBe(1080);
    expect(layer.sprite.texture.frame.width).toBe(1791);
  });
});
