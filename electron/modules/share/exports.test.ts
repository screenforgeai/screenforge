// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createExportRegistry, sameFile } from './exports';

const id = { dev: 1, ino: 42, size: 25, mtimeMs: 1000 };

describe('export registry', () => {
  it('knows a file this app exported, by path and identity', () => {
    const exports = createExportRegistry();
    exports.remember('/exports/demo.mp4', id);

    expect(exports.matches('/exports/demo.mp4', id)).toBe(true);
    expect(exports.matches('/exports/../exports/demo.mp4', id)).toBe(true);
    expect(exports.matches('/home/me/other.mp4', id)).toBe(false);
  });

  it('refuses the same path once another file stands there', () => {
    const exports = createExportRegistry();
    exports.remember('/exports/demo.mp4', id);

    expect(exports.matches('/exports/demo.mp4', { ...id, ino: 43 })).toBe(false);
    expect(exports.matches('/exports/demo.mp4', { ...id, size: 26 })).toBe(false);
    expect(exports.known('/exports/demo.mp4')).toEqual(id);
  });
});

describe('sameFile', () => {
  it('compares size and time, and device and inode when both are known', () => {
    expect(sameFile({ size: 25, mtimeMs: 1000 }, id)).toBe(true);
    expect(sameFile({ size: 25, mtimeMs: 1001 }, id)).toBe(false);
    expect(sameFile(id, { ...id, dev: 2 })).toBe(false);
  });
});
