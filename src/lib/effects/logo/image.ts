/**
 * Logo images, shared by the preview and the export window. Logos are data
 * URLs, so they're same-origin and never taint a canvas or WebGL upload.
 */
const MAX_CACHED = 4;
const cache = new Map<string, HTMLImageElement>();

export function getLogoImage(src: string): HTMLImageElement {
  let image = cache.get(src);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.src = src;
    cache.set(src, image);
    while (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value as string;
      cache.delete(oldest);
    }
  }
  return image;
}

export const isLogoImageReady = (image: HTMLImageElement): boolean =>
  image.complete && image.naturalWidth > 0;

/** Resolves once the logo has loaded (or failed), so export frames never miss it. */
export function preloadLogoImage(src: string): Promise<void> {
  const image = getLogoImage(src);
  if (image.complete) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const done = () => {
      image.removeEventListener('load', done);
      image.removeEventListener('error', done);
      resolve();
    };
    image.addEventListener('load', done);
    image.addEventListener('error', done);
  });
}
