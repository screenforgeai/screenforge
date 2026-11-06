// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { DirectorApiError } from '../director/client';
import type { DirectorShare } from './api';
import { createShareManager, MAX_SHARE_BYTES } from './shares';
import { createShareStore, type ShareStoreFs } from './store';
import type { ShareJobState, ShareLibrary } from '../../../src/types/index';

const memoryFs = (): ShareStoreFs => {
  const files = new Map<string, string>();
  return {
    readFile: async (p) => {
      const v = files.get(p);
      if (v === undefined) {
        throw new Error('ENOENT');
      }
      return v;
    },
    writeFile: async (p, d) => {
      files.set(p, d);
    },
    rename: async (a, b) => {
      files.set(b, files.get(a) ?? '');
      files.delete(a);
    },
    mkdir: async () => undefined,
  };
};

const share = (over: Partial<DirectorShare> = {}): DirectorShare => ({
  id: 'sh1',
  title: 'Demo',
  status: 'live',
  watchUrl: 'https://director.screenforge.co/s/sh1',
  expiresAt: '2026-12-06T10:00:00.000Z',
  sizeBytes: 25,
  durationS: 30,
  sharedAt: '2026-11-06T10:00:00.000Z',
  createdAt: '2026-11-06T09:59:00.000Z',
  ...over,
});

const targets = (numbers: number[]) =>
  numbers.map((partNumber) => ({ partNumber, url: `https://r2.test/sh1/${partNumber}` }));

interface SetupOptions {
  size?: number;
  mtimeMs?: number;
  fetch?: typeof globalThis.fetch;
}

const setup = ({ size = 25, mtimeMs = 1000, fetch }: SetupOptions = {}) => {
  let file: { size: number; mtimeMs: number } | null = { size, mtimeMs };
  const bytes = new Uint8Array(size);
  const api = {
    create: vi.fn(async () => ({
      share: share({ status: 'uploading', watchUrl: null, sharedAt: null }),
      upload: { partSize: 10, parts: targets([1, 2, 3]) },
    })),
    resume: vi.fn(async () => ({
      partSize: 10,
      uploadedParts: [{ partNumber: 1, etag: '"e1"' }],
      parts: targets([2, 3]),
    })),
    complete: vi.fn(async () => share()),
    list: vi.fn(async () => [share()]),
    remove: vi.fn(async () => null),
  };
  const defaultFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const reader = (init?.body as ReadableStream).getReader();
    while (!(await reader.read()).done) {
      // drain
    }
    return new Response(null, { headers: { ETag: `"e${String(url).split('/').pop()}"` } });
  });
  const states: ShareJobState[] = [];
  const libraries: ShareLibrary[] = [];
  const clipboard = vi.fn();
  const closeSource = vi.fn(async () => undefined);
  const store = createShareStore({ filePath: '/userData/share-links.json', fs: memoryFs() });
  const manager = createShareManager({
    api,
    store,
    fetch: fetch ?? defaultFetch,
    stat: async () => file,
    openSource: async () => ({
      source: { read: async (pos, len) => bytes.subarray(pos, pos + len) },
      close: closeSource,
    }),
    writeClipboard: clipboard,
    onState: (s) => states.push(s),
    onLibrary: (l) => libraries.push(l),
    now: () => Date.parse('2026-11-06T12:00:00.000Z'),
    sleep: async () => undefined,
  });
  const changeFile = (next: { size: number; mtimeMs: number } | null) => {
    file = next;
  };
  return {
    manager,
    api,
    store,
    states,
    libraries,
    clipboard,
    closeSource,
    changeFile,
    fetch: defaultFetch,
  };
};

const REQUEST = { filePath: '/exports/demo.mp4', projectId: 'p1', title: 'Demo', durationS: 29.6 };

describe('share manager', () => {
  it('uploads, completes, copies the link and remembers it for the project', async () => {
    const { manager, api, clipboard, states, store, closeSource } = setup();
    const result = await manager.share(REQUEST);

    expect(api.create).toHaveBeenCalledWith({
      title: 'Demo',
      contentType: 'video/mp4',
      sizeBytes: 25,
      durationS: 30,
    });
    expect(api.complete).toHaveBeenCalledWith('sh1', [
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 3, etag: '"e3"' },
    ]);
    expect(clipboard).toHaveBeenCalledWith('https://director.screenforge.co/s/sh1');
    expect(result).toMatchObject({
      status: 'done',
      copied: true,
      link: {
        shareId: 'sh1',
        watchUrl: 'https://director.screenforge.co/s/sh1',
        expiresAt: '2026-12-06T10:00:00.000Z',
        status: 'live',
      },
    });
    expect(states.map((s) => s.status)).toContain('uploading');
    expect(states.at(-1)?.status).toBe('done');
    const uploading = states.filter((s) => s.status === 'uploading');
    expect(uploading.at(-1)).toMatchObject({ uploadedBytes: 25, totalBytes: 25 });
    expect((await store.getLinks()).p1).toMatchObject({ shareId: 'sh1', title: 'Demo' });
    expect(await store.getUploads()).toEqual([]);
    expect(closeSource).toHaveBeenCalled();
  });

  it('shares webm too, and refuses other formats without calling Director', async () => {
    const { manager, api } = setup();
    await manager.share({ ...REQUEST, filePath: '/exports/demo.webm' });
    expect(api.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentType: 'video/webm' }),
    );
    api.create.mockClear();
    const gif = await manager.share({ ...REQUEST, filePath: '/exports/demo.gif' });
    expect(gif).toMatchObject({ status: 'failed', error: 'unsupported-format' });
    expect(api.create).not.toHaveBeenCalled();
  });

  it('refuses a file over 4 GB before asking Director', async () => {
    const { manager, api, changeFile } = setup({ size: 1 });
    changeFile({ size: MAX_SHARE_BYTES + 1, mtimeMs: 1 });
    expect(await manager.share(REQUEST)).toMatchObject({ status: 'failed', error: 'too-large' });
    expect(api.create).not.toHaveBeenCalled();
  });

  it('says so when the exported file is gone', async () => {
    const { manager, changeFile } = setup();
    changeFile(null);
    expect(await manager.share(REQUEST)).toMatchObject({ status: 'failed', error: 'file-missing' });
  });

  it.each([
    [new DirectorApiError(402, 'SHARE_TOO_LONG', 'too long'), 'too-long'],
    [new DirectorApiError(402, 'SHARE_LIMIT_REACHED', 'limit'), 'limit-reached'],
    [new DirectorApiError(413, 'PAYLOAD_TOO_LARGE', 'big'), 'too-large'],
    [new DirectorApiError(401, 'UNAUTHORIZED', 'no'), 'signed-out'],
    [new DirectorApiError(0, 'NETWORK_ERROR', 'offline'), 'interrupted'],
    [new DirectorApiError(500, 'HTTP_500', 'boom'), 'failed'],
  ])('explains Director refusing the share (%s)', async (error, code) => {
    const { manager, api, store } = setup();
    api.create.mockRejectedValueOnce(error);
    expect(await manager.share(REQUEST)).toMatchObject({
      status: 'failed',
      error: code,
      resumable: false,
    });
    expect(await store.getUploads()).toEqual([]);
  });

  it('keeps an upload the network interrupted, and resumes only the missing parts', async () => {
    let failing = true;
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const reader = (init?.body as ReadableStream).getReader();
      while (!(await reader.read()).done) {
        // drain
      }
      if (failing && String(url).endsWith('/2')) {
        throw new TypeError('fetch failed');
      }
      return new Response(null, { headers: { ETag: `"e${String(url).split('/').pop()}"` } });
    });
    const { manager, api, store, libraries } = setup({ fetch });

    const first = await manager.share(REQUEST);
    expect(first).toMatchObject({ status: 'failed', error: 'interrupted', resumable: true });
    expect(await store.getUploads()).toEqual([
      expect.objectContaining({ shareId: 'sh1', filePath: '/exports/demo.mp4', sizeBytes: 25 }),
    ]);
    expect(libraries.at(-1)?.pending).toEqual({ p1: { fileName: 'demo.mp4', sizeBytes: 25 } });
    expect(await manager.canResume('/exports/demo.mp4')).toBe(true);

    failing = false;
    fetch.mockClear();
    const second = await manager.share(REQUEST);
    expect(second.status).toBe('done');
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.resume).toHaveBeenCalledWith('sh1');
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      'https://r2.test/sh1/2',
      'https://r2.test/sh1/3',
    ]);
    expect(api.complete).toHaveBeenLastCalledWith('sh1', [
      { partNumber: 1, etag: '"e1"' },
      { partNumber: 2, etag: '"e2"' },
      { partNumber: 3, etag: '"e3"' },
    ]);
    expect(await store.getUploads()).toEqual([]);
  });

  it('starts over when the file changed since the upload stopped, removing the old share', async () => {
    const { manager, api, store, changeFile } = setup();
    await store.putUpload({
      shareId: 'old',
      filePath: '/exports/demo.mp4',
      sizeBytes: 25,
      mtimeMs: 1,
      projectId: 'p1',
      title: 'Demo',
      durationS: 30,
      contentType: 'video/mp4',
    });
    changeFile({ size: 25, mtimeMs: 2 });
    expect(await manager.canResume('/exports/demo.mp4')).toBe(false);
    await manager.share(REQUEST);
    expect(api.resume).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledWith('old');
    expect(api.create).toHaveBeenCalled();
  });

  it('starts over when Director no longer has the unfinished share', async () => {
    const { manager, api, store } = setup();
    await store.putUpload({
      shareId: 'gone',
      filePath: '/exports/demo.mp4',
      sizeBytes: 25,
      mtimeMs: 1000,
      projectId: 'p1',
      title: 'Demo',
      durationS: 30,
      contentType: 'video/mp4',
    });
    api.resume.mockRejectedValueOnce(new DirectorApiError(404, 'SHARE_NOT_FOUND', 'gone'));
    expect((await manager.share(REQUEST)).status).toBe('done');
    expect(api.create).toHaveBeenCalled();
  });

  it('cancelling stops the upload, removes the share in Director and forgets it', async () => {
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          (init?.signal as AbortSignal).addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const { manager, api, store, states } = setup({ fetch });
    const pending = manager.share(REQUEST);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    manager.cancel();
    expect(await pending).toEqual({ status: 'idle' });
    expect(api.remove).toHaveBeenCalledWith('sh1');
    expect(api.complete).not.toHaveBeenCalled();
    expect(await store.getUploads()).toEqual([]);
    expect(states.at(-1)).toEqual({ status: 'idle' });
  });

  it('runs one share at a time', async () => {
    const { manager } = setup();
    const first = manager.share(REQUEST);
    expect(await manager.share(REQUEST)).toMatchObject({ status: 'failed', error: 'busy' });
    expect((await first).status).toBe('done');
  });

  it('still succeeds when the clipboard is unavailable', async () => {
    const { manager, clipboard } = setup();
    clipboard.mockImplementationOnce(() => {
      throw new Error('no clipboard');
    });
    expect(await manager.share(REQUEST)).toMatchObject({ status: 'done', copied: false });
  });

  it('does not remember a link for a project that was never saved', async () => {
    const { manager, store } = setup();
    await manager.share({ ...REQUEST, projectId: null });
    expect(await store.getLinks()).toEqual({});
  });

  describe('library', () => {
    it('refreshes links from Director: expired and removed ones show as such', async () => {
      const { manager, api, store } = setup();
      await store.setLink('p1', {
        shareId: 'sh1',
        title: 'Demo',
        watchUrl: 'u1',
        expiresAt: '2026-12-01T00:00:00.000Z',
        status: 'live',
        sharedAt: null,
      });
      await store.setLink('p2', {
        shareId: 'sh2',
        title: 'Old',
        watchUrl: 'u2',
        expiresAt: '2026-11-01T00:00:00.000Z',
        status: 'live',
        sharedAt: null,
      });
      await store.setLink('p3', {
        shareId: 'sh3',
        title: 'Gone',
        watchUrl: 'u3',
        expiresAt: null,
        status: 'live',
        sharedAt: null,
      });
      api.list.mockResolvedValueOnce([
        share({ id: 'sh1', expiresAt: null }),
        share({ id: 'sh2', status: 'expired' }),
      ]);
      const library = await manager.refreshLibrary();
      expect(library.links.p1).toMatchObject({ status: 'live', expiresAt: null });
      expect(library.links.p2.status).toBe('expired');
      expect(library.links.p3.status).toBe('removed');
    });

    it('treats an unknown status as not live', async () => {
      const { manager, api, store } = setup();
      await store.setLink('p1', {
        shareId: 'sh1',
        title: 'Demo',
        watchUrl: 'u1',
        expiresAt: null,
        status: 'live',
        sharedAt: null,
      });
      api.list.mockResolvedValueOnce([share({ id: 'sh1', status: 'quarantined' })]);
      expect((await manager.refreshLibrary()).links.p1.status).toBe('removed');
    });

    it('keeps the saved links when Director cannot be reached, marking past expiry', async () => {
      const { manager, api, store } = setup();
      await store.setLink('p1', {
        shareId: 'sh1',
        title: 'Demo',
        watchUrl: 'u1',
        expiresAt: '2026-11-01T00:00:00.000Z',
        status: 'live',
        sharedAt: null,
      });
      api.list.mockRejectedValueOnce(new DirectorApiError(0, 'NETWORK_ERROR', 'offline'));
      const library = await manager.refreshLibrary();
      expect(library.links.p1).toMatchObject({ shareId: 'sh1', status: 'expired' });
    });

    it('removes a live link in Director, then forgets it', async () => {
      const { manager, api, store } = setup();
      await manager.share(REQUEST);
      expect(await manager.removeLink('p1')).toEqual({ ok: true });
      expect(api.remove).toHaveBeenCalledWith('sh1');
      expect(await store.getLinks()).toEqual({});
    });

    it('keeps the link when Director refuses to remove it', async () => {
      const { manager, api, store } = setup();
      await manager.share(REQUEST);
      api.remove.mockRejectedValueOnce(new DirectorApiError(401, 'UNAUTHORIZED', 'no'));
      expect(await manager.removeLink('p1')).toEqual({ ok: false, error: 'signed-out' });
      expect(Object.keys(await store.getLinks())).toEqual(['p1']);
    });

    it('forgets an expired link without asking Director', async () => {
      const { manager, api, store } = setup();
      await store.setLink('p1', {
        shareId: 'sh1',
        title: 'Demo',
        watchUrl: 'u1',
        expiresAt: '2026-11-01T00:00:00.000Z',
        status: 'expired',
        sharedAt: null,
      });
      expect(await manager.removeLink('p1')).toEqual({ ok: true });
      expect(api.remove).not.toHaveBeenCalled();
    });

    it('copies a project’s link', async () => {
      const { manager, clipboard } = setup();
      await manager.share(REQUEST);
      clipboard.mockClear();
      expect(await manager.copyLink('p1')).toBe(true);
      expect(clipboard).toHaveBeenCalledWith('https://director.screenforge.co/s/sh1');
      expect(await manager.copyLink('nope')).toBe(false);
    });

    it('resumes or discards a project’s unfinished upload', async () => {
      const { manager, api, store } = setup();
      const pending = {
        shareId: 'sh1',
        filePath: '/exports/demo.mp4',
        sizeBytes: 25,
        mtimeMs: 1000,
        projectId: 'p1',
        title: 'Demo',
        durationS: 30,
        contentType: 'video/mp4' as const,
      };
      await store.putUpload(pending);
      expect((await manager.resumeProject('p1')).status).toBe('done');
      expect(api.resume).toHaveBeenCalledWith('sh1');

      await store.putUpload({ ...pending, shareId: 'sh9' });
      expect(await manager.discardPending('p1')).toEqual({ ok: true });
      expect(api.remove).toHaveBeenCalledWith('sh9');
      expect(await store.getUploads()).toEqual([]);
    });
  });
});
