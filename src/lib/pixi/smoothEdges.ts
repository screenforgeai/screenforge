import type { Filter, TextureSource } from 'pixi.js';

/**
 * For a texture drawn larger than it is shown (a cursor drawn at 6 px per unit, a Retina
 * recording in a smaller preview): a mip chain, sampled trilinearly, so shrinking it averages
 * texels instead of skipping them and edges stay smooth instead of breaking into steps. Call
 * before the texture is first drawn; Pixi rebuilds the chain on every update.
 */
export function smoothWhenShrunk(source: TextureSource): void {
  source.autoGenerateMipmaps = true;
  source.style.minFilter = 'linear';
  source.style.magFilter = 'linear';
  source.style.mipmapFilter = 'linear';
}

/**
 * A filter draws what it wraps into its own texture first, and that texture is not antialiased
 * unless asked, so rounded masks and shapes inside it came out stepped. 'inherit' gives it the
 * antialiasing of whatever it draws into, the canvas included.
 */
export function smoothFilterEdges<T extends Filter>(filter: T): T {
  filter.antialias = 'inherit';
  return filter;
}
