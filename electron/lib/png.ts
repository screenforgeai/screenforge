/**
 * PNG checks done on the raw bytes, so a still never has to be decoded (or
 * re-encoded) in the main process just to be validated or measured.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4).
const HEADER_LENGTH = 24;

export function isPng(bytes: unknown): bytes is Uint8Array {
  return (
    bytes instanceof Uint8Array &&
    bytes.length >= HEADER_LENGTH &&
    SIGNATURE.every((byte, i) => bytes[i] === byte) &&
    String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) === 'IHDR'
  );
}

/** Pixel size from the PNG header; null when the bytes aren't a usable PNG. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isPng(bytes)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}
