import { describe, expect, it } from 'vitest';
import { nv12Layout, rgbToYuv709Full } from './nv12Readback';

describe('nv12Layout', () => {
  it('packs a 1080p frame into a quarter-width target with luma then chroma rows', () => {
    expect(nv12Layout(1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
      stride: 1920,
      targetWidth: 480,
      targetHeight: 1620,
      uvOffset: 1920 * 1080,
      byteLength: 1920 * 1620,
    });
  });

  it('pads rows to a multiple of 4 bytes when the width is not', () => {
    // Export sizes are only rounded to even, e.g. 1634×1080.
    const layout = nv12Layout(1634, 1080);
    expect(layout?.targetWidth).toBe(409);
    expect(layout?.stride).toBe(1636);
    expect(layout?.uvOffset).toBe(1636 * 1080);
    expect(layout?.byteLength).toBe(1636 * 1620);
  });

  it('refuses sizes NV12 cannot hold', () => {
    expect(nv12Layout(1633, 1080)).toBeNull();
    expect(nv12Layout(1920, 1079)).toBeNull();
    expect(nv12Layout(0, 0)).toBeNull();
    expect(nv12Layout(19.5, 10)).toBeNull();
  });
});

describe('rgbToYuv709Full', () => {
  const close = (actual: number[], expected: number[]) =>
    actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 4));

  it('maps black, white and grey to neutral chroma at full range', () => {
    close(rgbToYuv709Full(0, 0, 0), [0, 0.5, 0.5]);
    close(rgbToYuv709Full(1, 1, 1), [1, 0.5, 0.5]);
    close(rgbToYuv709Full(0.5, 0.5, 0.5), [0.5, 0.5, 0.5]);
  });

  it('uses BT.709 weights, so pure primaries reach the chroma limits', () => {
    close(rgbToYuv709Full(1, 0, 0), [0.2126, 0.5 - 0.2126 / 1.8556, 1]);
    close(rgbToYuv709Full(0, 0, 1), [0.0722, 1, 0.5 - 0.0722 / 1.5748]);
    close(rgbToYuv709Full(0, 1, 0), [0.7152, 0.5 - 0.7152 / 1.8556, 0.5 - 0.7152 / 1.5748]);
  });
});
