import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKGROUND } from 'src/lib/effects/frame';
import { MAX_STUDIO_DIMENSION, getStudioOutputSize } from './output';

const style = (aspectRatioId: string) => ({
  frameEnabled: false,
  aspectRatioId,
  background: { ...DEFAULT_BACKGROUND },
});

describe('getStudioOutputSize', () => {
  it('keeps the chosen aspect ratio', () => {
    const { width, height } = getStudioOutputSize(1600, 1000, style('16:9'));
    expect(width / height).toBeCloseTo(16 / 9, 2);
  });

  it('frames the screenshot even when the flat frame is switched off', () => {
    const { width } = getStudioOutputSize(1600, 1000, style('original'));
    expect(width).toBeGreaterThan(1600);
  });

  it('caps the longest side so a large retina capture never needs a huge GPU buffer', () => {
    const { width, height } = getStudioOutputSize(6016, 3384, style('original'));
    expect(Math.max(width, height)).toBe(MAX_STUDIO_DIMENSION);
  });
});
