import { BlurFilter, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { smoothFilterEdges, smoothWhenShrunk } from './smoothEdges';

describe('smooth edges', () => {
  it('gives a texture drawn large and shown small a mip chain, sampled trilinearly', () => {
    // Cursors are drawn at 6 px per unit and shown a few times smaller: without mipmaps the
    // GPU skips texels and the outline breaks into steps.
    const canvas = document.createElement('canvas');
    canvas.width = 144;
    canvas.height = 144;
    const texture = Texture.from(canvas, true);

    smoothWhenShrunk(texture.source);

    expect(texture.source.autoGenerateMipmaps).toBe(true);
    expect(texture.source.style.minFilter).toBe('linear');
    expect(texture.source.style.mipmapFilter).toBe('linear');
  });

  it('lets a filter keep the canvas antialiasing for what it wraps', () => {
    // A filter draws its content into its own texture first, which is not antialiased
    // unless asked: rounded masks inside it came out stepped.
    const filter = new BlurFilter();

    smoothFilterEdges(filter);

    expect(filter.antialias).toBe('inherit');
  });
});
