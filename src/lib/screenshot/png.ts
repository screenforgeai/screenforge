/**
 * Screenshot pixels move between processes as PNG bytes and are shown through
 * blob: URLs, never base64 data: URLs (a third larger, and built and parsed in
 * one blocking pass on both ends).
 */

/** Encodes a canvas as PNG bytes; toBlob encodes without blocking the UI like toDataURL does. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not encode the screenshot'));
        return;
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, 'image/png');
  });
}

/** A blob: URL for PNG bytes. Release it with releaseImageUrl once nothing shows it. */
export function createPngUrl(png: Uint8Array): string {
  return URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
}

/** Frees a URL from createPngUrl; data: URLs need nothing. */
export function releaseImageUrl(url: string | null | undefined): void {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
}
