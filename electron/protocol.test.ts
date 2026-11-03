// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  protocol: {
    handle: vi.fn(),
  },
}));

describe('screenforge protocol range parsing', () => {
  it('parses open-ended byte ranges', async () => {
    const { __testing } = await import('./protocol');

    expect(__testing.parseByteRange('bytes=100-', 1_000)).toEqual({
      ok: true,
      start: 100,
      end: 999,
    });
  });

  it('parses suffix byte ranges without producing NaN offsets', async () => {
    const { __testing } = await import('./protocol');

    expect(__testing.parseByteRange('bytes=-128', 1_000)).toEqual({
      ok: true,
      start: 872,
      end: 999,
    });
  });

  it('clips ranges that extend past the end of the file', async () => {
    const { __testing } = await import('./protocol');

    expect(__testing.parseByteRange('bytes=900-1200', 1_000)).toEqual({
      ok: true,
      start: 900,
      end: 999,
    });
  });

  it('rejects unsatisfiable or malformed ranges', async () => {
    const { __testing } = await import('./protocol');

    expect(__testing.parseByteRange('bytes=1000-', 1_000)).toEqual({ ok: false });
    expect(__testing.parseByteRange('bytes=200-100', 1_000)).toEqual({ ok: false });
    expect(__testing.parseByteRange('bytes=-0', 1_000)).toEqual({ ok: false });
    expect(__testing.parseByteRange('bytes=0-1,2-3', 1_000)).toEqual({ ok: false });
  });
});

describe('screenforge protocol file path decoding', () => {
  it('decodes encoded POSIX paths', async () => {
    const { __testing } = await import('./protocol');

    expect(
      __testing.decodeScreenforgeFilePath(
        'screenforge://local/%2FUsers%2Fmo%2FTemp%2Fvideo%20file.mp4',
      ),
    ).toBe('/Users/mo/Temp/video file.mp4');
  });

  it('decodes encoded Windows paths without losing the drive colon', async () => {
    const { __testing } = await import('./protocol');

    expect(
      __testing.decodeScreenforgeFilePath(
        'screenforge://local/C%3A%5CUsers%5CMOIZAR~1%5CAppData%5CLocal%5CTemp%5Cvideo.mp4',
      ),
    ).toBe('C:\\Users\\MOIZAR~1\\AppData\\Local\\Temp\\video.mp4');
  });

  it('keeps compatibility with the malformed legacy Windows URL shape', async () => {
    const { __testing } = await import('./protocol');

    expect(
      __testing.decodeScreenforgeFilePath(
        'screenforge://localc/Users/MOIZAR~1/AppData/Local/Temp/video.mp4',
      ),
    ).toBe('C:\\Users\\MOIZAR~1\\AppData\\Local\\Temp\\video.mp4');
  });
});
