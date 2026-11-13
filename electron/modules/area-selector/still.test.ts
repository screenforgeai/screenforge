import { describe, expect, it } from 'vitest';
import { toAreaSelectorStill } from './still';

describe('toAreaSelectorStill', () => {
  const png = new Uint8Array([137, 80, 78, 71]);

  it('accepts PNG bytes with their pixel size', () => {
    expect(toAreaSelectorStill({ png, width: 2560, height: 1440 })).toEqual({
      png,
      width: 2560,
      height: 1440,
    });
  });

  it('refuses anything else the renderer might send', () => {
    expect(toAreaSelectorStill(null)).toBeNull();
    expect(toAreaSelectorStill({ png: 'AA==', width: 10, height: 10 })).toBeNull();
    expect(toAreaSelectorStill({ png, width: 0, height: 10 })).toBeNull();
    expect(toAreaSelectorStill({ png, width: 10.5, height: 10 })).toBeNull();
    expect(toAreaSelectorStill({ png, width: 10, height: Number.NaN })).toBeNull();
    expect(toAreaSelectorStill({ png: new Uint8Array(), width: 10, height: 10 })).toBeNull();
  });

  it('refuses a still too large to be a screen', () => {
    expect(toAreaSelectorStill({ png, width: 20_000, height: 10 })).toBeNull();
    expect(
      toAreaSelectorStill({ png: new Uint8Array(200 * 1024 * 1024 + 1), width: 10, height: 10 }),
    ).toBeNull();
  });
});
