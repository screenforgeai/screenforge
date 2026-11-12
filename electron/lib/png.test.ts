// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { isPng, readPngSize } from './png';

/** A PNG header (signature + IHDR) for the given size; enough for the checks. */
const pngHeader = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

describe('isPng', () => {
  it('accepts PNG bytes', () => {
    expect(isPng(pngHeader(10, 10))).toBe(true);
    expect(isPng(new Uint8Array(pngHeader(10, 10)))).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isPng('data:image/png;base64,AAAA')).toBe(false);
    expect(isPng(Buffer.from('not a png at all, really not'))).toBe(false);
    expect(isPng(pngHeader(10, 10).subarray(0, 20))).toBe(false);
    const jpeg = pngHeader(10, 10);
    jpeg[1] = 0;
    expect(isPng(jpeg)).toBe(false);
  });
});

describe('readPngSize', () => {
  it('reads the pixel size from the header', () => {
    expect(readPngSize(pngHeader(3024, 1964))).toEqual({ width: 3024, height: 1964 });
  });

  it('reads a header that sits inside a larger buffer', () => {
    const pool = Buffer.concat([Buffer.alloc(7), pngHeader(600, 400)]);
    expect(readPngSize(pool.subarray(7))).toEqual({ width: 600, height: 400 });
  });

  it('returns null for an empty or broken image', () => {
    expect(readPngSize(pngHeader(0, 400))).toBeNull();
    expect(readPngSize(Buffer.from('nope'))).toBeNull();
  });
});
