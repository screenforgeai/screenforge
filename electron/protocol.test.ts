// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
  },
}));

vi.mock('electron', () => electronMock);

describe('screenforge scheme registration', () => {
  it('registers the scheme as CORS-enabled so app pages can fetch from it', async () => {
    // Chromium in Electron 45 blocks cross-origin fetches (and WebGL uploads of
    // media) from schemes that are not CORS-enabled; app pages are file:// or
    // the Vite dev server, so every screenforge:// request is cross-origin.
    const { registerSchemePrivileges } = await import('./protocol');

    registerSchemePrivileges();

    expect(electronMock.protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: 'screenforge',
        privileges: {
          secure: true,
          standard: true,
          stream: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
    ]);
  });
});

describe('screenforge protocol responses', () => {
  const DEV_ORIGIN = 'http://localhost:5173';

  async function getHandler(): Promise<(req: Request) => Response> {
    const { registerProtocols } = await import('./protocol');
    electronMock.protocol.handle.mockClear();
    // Packaged file:// pages send the literal origin "null".
    registerProtocols(['null', DEV_ORIGIN]);
    const [, handler] = electronMock.protocol.handle.mock.calls[0] ?? [];
    return handler;
  }

  async function withTempFile<T>(run: (url: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'screenforge-protocol-'));
    try {
      const filePath = path.join(dir, 'clip.mp4');
      await fs.writeFile(filePath, '0123456789');
      return await run(`screenforge://local/${encodeURIComponent(filePath)}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  it('allows the app origins on full, ranged and missing-file responses', async () => {
    const handler = await getHandler();

    await withTempFile(async (url) => {
      const full = handler(new Request(url, { headers: { Origin: 'null' } }));
      const ranged = handler(
        new Request(url, { headers: { Origin: DEV_ORIGIN, Range: 'bytes=2-5' } }),
      );
      const missing = handler(
        new Request('screenforge://local/%2Fnope%2Fmissing.mp4', { headers: { Origin: 'null' } }),
      );

      expect(full.status).toBe(200);
      expect(ranged.status).toBe(206);
      expect(missing.status).toBe(404);
      expect(full.headers.get('Access-Control-Allow-Origin')).toBe('null');
      expect(ranged.headers.get('Access-Control-Allow-Origin')).toBe(DEV_ORIGIN);
      expect(missing.headers.get('Access-Control-Allow-Origin')).toBe('null');
      for (const response of [full, ranged, missing]) {
        expect(response.headers.get('Vary')).toBe('Origin');
      }
      await expect(ranged.text()).resolves.toBe('2345');
      await full.body?.cancel();
    });
  });

  it('gives other origins and origin-less requests no CORS access', async () => {
    const handler = await getHandler();

    await withTempFile(async (url) => {
      const foreign = handler(new Request(url, { headers: { Origin: 'https://example.com' } }));
      const noOrigin = handler(new Request(url));

      for (const response of [foreign, noOrigin]) {
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
        expect(response.headers.get('Vary')).toBe('Origin');
        await response.body?.cancel();
      }
    });
  });
});

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
