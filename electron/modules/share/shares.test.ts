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
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
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
  numbers.map((partNumber) => ({
    partNumber,
    url: `https://acct.r2.cloudflarestorage.com/sh1/${partNumber}`,
  }));

interface SetupOptions {
  size?: number;
  mtimeMs?: number;
  fetch?: typeof globalThis.fetch;
  allowLoopbackUploads?: boolean;
  /** Whether this app exported the file (in this run). */
  exported?: boolean;
  /** The signed-in account, as `workspace:user`; null when signed out. */
  account?: string | null;
}

const setup = ({
  size = 25,
  mtimeMs = 1000,
  fetch,
  allowLoopbackUploads,
  exported = true,
  account = 'w1:u1',
}: SetupOptions = {}) => {
  let currentAccount = account;
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
  const isExported = vi.fn(async () => exported);
  const openSource = vi.fn<
    (
      filePath: string,
      expected: { size: number; mtimeMs: number },
    ) => Promise<{
      source: { read: (pos: number, len: number) => Promise<Uint8Array> };
      close: () => Promise<undefined>;
    }>
  >(async () => ({
    source: { read: async (pos, len) => bytes.subarray(pos, pos + len) },
    close: closeSource,
  }));
  const store = createShareStore({ filePath: '/userData/share-links.json', fs: memoryFs() });
  const manager = createShareManager({
    api,
    store,
    fetch: fetch ?? defaultFetch,
    stat: async () => file,
    isExported,
    currentAccount: () => currentAccount,
    openSource,
    writeClipboard: clipboard,
    onState: (s) => states.push(s),
    onLibrary: (l) => libraries.push(l),
    now: () => Date.parse('2026-11-06T12:00:00.000Z'),
    sleep: async () => undefined,
    allowLoopbackUploads,
  });
  const changeFile = (next: { size: number; mtimeMs: number } | null) => {
    file = next;
  };
  const switchAccount = (next: string | null) => {
    currentAccount = next;
  };
  return {
    manager,
    api,
    store,
    states,
    libraries,
    clipboard,
    closeSource,
    openSource,
    isExported,
    changeFile,
    switchAccount,
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
      'https://acct.r2.cloudflarestorage.com/sh1/2',
      'https://acct.r2.cloudflarestorage.com/sh1/3',
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

  it('keeps an unfinished upload when Director fails for a moment, to resume later', async () => {
    const { manager, api, store } = setup();
    await store.putUpload({
      shareId: 'sh1',
      filePath: '/exports/demo.mp4',
      sizeBytes: 25,
      mtimeMs: 1000,
      projectId: 'p1',
      title: 'Demo',
      durationS: 30,
      contentType: 'video/mp4',
    });
    api.resume.mockRejectedValueOnce(new DirectorApiError(503, 'HTTP_503', 'Unavailable'));

    const result = await manager.share(REQUEST);

    expect(result).toMatchObject({ status: 'failed', resumable: true });
    expect(api.remove).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(await store.getUploads()).toEqual([expect.objectContaining({ shareId: 'sh1' })]);
  });

  it('starts over when Director says the upload can no longer be resumed', async () => {
    const { manager, api, store } = setup();
    await store.putUpload({
      shareId: 'done-elsewhere',
      filePath: '/exports/demo.mp4',
      sizeBytes: 25,
      mtimeMs: 1000,
      projectId: 'p1',
      title: 'Demo',
      durationS: 30,
      contentType: 'video/mp4',
    });
    api.resume.mockRejectedValueOnce(
      new DirectorApiError(409, 'SHARE_NOT_UPLOADING', 'Not uploading'),
    );

    expect((await manager.share(REQUEST)).status).toBe('done');
    expect(api.remove).toHaveBeenCalledWith('done-elsewhere');
    expect(api.create).toHaveBeenCalled();
  });

  it('shares only a file this app exported, reading nothing otherwise', async () => {
    const { manager, api, openSource, isExported } = setup({ exported: false });

    const result = await manager.share({ ...REQUEST, filePath: '/home/me/secret.mp4' });

    expect(isExported).toHaveBeenCalledWith('/home/me/secret.mp4');
    expect(result).toMatchObject({ status: 'failed', error: 'failed', resumable: false });
    expect(api.create).not.toHaveBeenCalled();
    expect(openSource).not.toHaveBeenCalled();
  });

  it('still resumes an upload it started before a restart, without a fresh export', async () => {
    const { manager, api, store } = setup({ exported: false });
    await store.putUpload({
      shareId: 'sh1',
      filePath: '/exports/demo.mp4',
      sizeBytes: 25,
      mtimeMs: 1000,
      projectId: 'p1',
      title: 'Demo',
      durationS: 30,
      contentType: 'video/mp4',
    });

    expect((await manager.share(REQUEST)).status).toBe('done');
    expect(api.resume).toHaveBeenCalledWith('sh1');
  });

  it('opens the file expecting the exact size and time it checked', async () => {
    const { manager, openSource } = setup({ size: 25, mtimeMs: 1000 });

    await manager.share(REQUEST);

    expect(openSource).toHaveBeenCalledWith('/exports/demo.mp4', { size: 25, mtimeMs: 1000 });
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

  it('fails a share whose part URLs are not Cloudflare R2, sending nothing and keeping nothing', async () => {
    const { manager, api, store, fetch } = setup();
    api.create.mockResolvedValueOnce({
      share: share({ status: 'uploading', watchUrl: null, sharedAt: null }),
      upload: {
        partSize: 10,
        parts: [
          { partNumber: 1, url: 'https://acct.r2.cloudflarestorage.com/sh1/1' },
          { partNumber: 2, url: 'https://evil.example/sh1/2' },
          { partNumber: 3, url: 'https://acct.r2.cloudflarestorage.com/sh1/3' },
        ],
      },
    });
    expect(await manager.share(REQUEST)).toMatchObject({
      status: 'failed',
      error: 'failed',
      resumable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(api.complete).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledWith('sh1');
    expect(await store.getUploads()).toEqual([]);
  });

  it('uploads to local part URLs only when Director itself is local', async () => {
    const localParts = {
      partSize: 10,
      parts: [1, 2, 3].map((partNumber) => ({
        partNumber,
        url: `http://localhost:9000/sh1/${partNumber}`,
      })),
    };
    const remote = setup();
    remote.api.create.mockResolvedValueOnce({
      share: share({ status: 'uploading', watchUrl: null, sharedAt: null }),
      upload: localParts,
    });
    expect(await remote.manager.share(REQUEST)).toMatchObject({
      status: 'failed',
      error: 'failed',
    });
    expect(remote.fetch).not.toHaveBeenCalled();

    const local = setup({ allowLoopbackUploads: true });
    local.api.create.mockResolvedValueOnce({
      share: share({ status: 'uploading', watchUrl: null, sharedAt: null }),
      upload: localParts,
    });
    expect((await local.manager.share(REQUEST)).status).toBe('done');
    expect(local.fetch).toHaveBeenCalledTimes(3);
  });

  it.each([
    'javascript:alert(1)',
    'http://director.screenforge.co/s/sh1',
    'file:///etc/passwd',
    'smb://host/share',
    'not a url',
  ])('keeps no watch link when Director sends %s', async (watchUrl) => {
    const { manager, api, clipboard, store } = setup();
    api.complete.mockResolvedValueOnce(share({ watchUrl }));
    const result = await manager.share(REQUEST);
    expect(result).toMatchObject({ status: 'done', copied: false, link: { watchUrl: null } });
    expect(clipboard).not.toHaveBeenCalled();
    expect((await store.getLinks()).p1?.watchUrl).toBeNull();
  });

  it('keeps an https watch link on a customer’s own domain', async () => {
    const { manager, api, clipboard } = setup();
    api.complete.mockResolvedValueOnce(share({ watchUrl: 'https://help.customer.example/s/sh1' }));
    expect(await manager.share(REQUEST)).toMatchObject({
      link: { watchUrl: 'https://help.customer.example/s/sh1' },
      copied: true,
    });
    expect(clipboard).toHaveBeenCalledWith('https://help.customer.example/s/sh1');
  });

  describe('finishing', () => {
    it('keeps the uploaded parts when finishing fails for a moment', async () => {
      const { manager, api, store } = setup();
      api.complete.mockRejectedValueOnce(new DirectorApiError(503, 'HTTP_503', 'down'));

      const result = await manager.share(REQUEST);

      expect(result).toMatchObject({ status: 'failed', error: 'interrupted', resumable: true });
      expect(api.remove).not.toHaveBeenCalled();
      expect(await store.getUploads()).toEqual([expect.objectContaining({ shareId: 'sh1' })]);
      expect(await store.getDeletions()).toEqual([]);
    });

    it('keeps them when Director says parts are still missing, to upload them on resume', async () => {
      const { manager, api, store } = setup();
      api.complete.mockRejectedValueOnce(
        new DirectorApiError(400, 'SHARE_UPLOAD_INCOMPLETE', 'missing parts'),
      );

      expect(await manager.share(REQUEST)).toMatchObject({ resumable: true });
      expect(await store.getUploads()).toHaveLength(1);
    });

    it('lets the upload go when Director refuses the finished file', async () => {
      const { manager, api, store } = setup();
      api.complete.mockRejectedValueOnce(
        new DirectorApiError(422, 'SHARE_NOT_A_VIDEO', 'not a video'),
      );

      expect(await manager.share(REQUEST)).toMatchObject({ status: 'failed', resumable: false });
      expect(await store.getUploads()).toEqual([]);
    });

    it('takes the share down when it was cancelled while finishing', async () => {
      const { manager, api, store, clipboard } = setup();
      api.complete.mockImplementationOnce(async () => {
        manager.cancel();
        return share();
      });

      expect(await manager.share(REQUEST)).toEqual({ status: 'idle' });
      expect(api.remove).toHaveBeenCalledWith('sh1');
      expect(await store.getLinks()).toEqual({});
      expect(clipboard).not.toHaveBeenCalled();
    });
  });

  it('a refresh that started before a share finished leaves the new link alone', async () => {
    const { manager, api, store } = setup();
    const saved = {
      shareId: 'old',
      title: 'Old',
      watchUrl: 'https://director.screenforge.co/s/old',
      expiresAt: null,
      status: 'live' as const,
      sharedAt: '2026-11-01T10:00:00.000Z',
      account: 'w1:u1',
    };
    await store.setLink('p0', saved);
    api.list.mockImplementationOnce(async () => {
      // The share finishes while Director's list is on its way.
      await store.setLink('p2', { ...saved, shareId: 'new', title: 'New' });
      return [];
    });

    await manager.refreshLibrary();

    const links = await store.getLinks();
    expect(links.p0.status).toBe('removed');
    expect(links.p2.status).toBe('live');
  });

  it('re-exporting a shared file clears the finished share, so it can be shared again', async () => {
    const { manager, states } = setup();
    await manager.share(REQUEST);
    expect(manager.getState().status).toBe('done');

    manager.clearFor('/exports/other.mp4');
    expect(manager.getState().status).toBe('done');

    manager.clearFor('/exports/demo.mp4');
    expect(manager.getState()).toEqual({ status: 'idle' });
    expect(states.at(-1)).toEqual({ status: 'idle' });
  });

  describe('remote cleanup', () => {
    const cancelledShare = async (removeFails: boolean) => {
      const fetch = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            (init?.signal as AbortSignal).addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
      const t = setup({ fetch });
      if (removeFails) {
        t.api.remove.mockRejectedValueOnce(new DirectorApiError(0, 'NETWORK_ERROR', 'offline'));
      }
      const pending = t.manager.share(REQUEST);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
      t.manager.cancel();
      await pending;
      return t;
    };

    it('clears the deletion once Director confirms it', async () => {
      const { store } = await cancelledShare(false);
      expect(await store.getDeletions()).toEqual([]);
    });

    it('keeps a cancelled upload’s deletion until Director confirms it, and retries on refresh', async () => {
      const { manager, api, store } = await cancelledShare(true);

      expect(await store.getUploads()).toEqual([]);
      expect(await store.getDeletions()).toEqual([{ shareId: 'sh1', account: 'w1:u1' }]);

      api.remove.mockClear();
      await manager.refreshLibrary();
      expect(api.remove).toHaveBeenCalledWith('sh1');
      expect(await store.getDeletions()).toEqual([]);
    });

    it('treats a share Director no longer has as deleted', async () => {
      const { manager, api, store } = await cancelledShare(true);
      api.remove.mockRejectedValueOnce(new DirectorApiError(404, 'NOT_FOUND', 'gone'));
      await manager.refreshLibrary();
      expect(await store.getDeletions()).toEqual([]);
    });

    it('keeps trying to delete a discarded upload in Director', async () => {
      const { manager, api, store } = setup();
      await store.putUpload({
        shareId: 'sh9',
        filePath: '/exports/demo.mp4',
        sizeBytes: 25,
        mtimeMs: 1000,
        projectId: 'p1',
        title: 'Demo',
        durationS: 30,
        contentType: 'video/mp4',
        account: 'w1:u1',
      });
      api.remove.mockRejectedValueOnce(new DirectorApiError(503, 'HTTP_503', 'down'));

      expect(await manager.discardPending('p1')).toEqual({ ok: true });
      expect((await manager.getLibrary()).pending).toEqual({});
      expect(await store.getDeletions()).toEqual([{ shareId: 'sh9', account: 'w1:u1' }]);
    });

    it('saves the project link before forgetting the finished upload', async () => {
      const { manager, store } = setup();
      const setLink = vi.spyOn(store, 'setLink');
      const removeUpload = vi.spyOn(store, 'removeUpload');

      await manager.share(REQUEST);

      expect(setLink.mock.invocationCallOrder[0]).toBeLessThan(
        removeUpload.mock.invocationCallOrder[0],
      );
    });
  });

  describe('accounts', () => {
    it('records which account made each upload and link', async () => {
      const { manager, store } = setup();
      await manager.share(REQUEST);
      expect((await store.getLinks()).p1).toMatchObject({ shareId: 'sh1', account: 'w1:u1' });
    });

    it('leaves another account’s links alone when refreshing, and doesn’t list them', async () => {
      const { manager, api, store, switchAccount } = setup();
      await manager.share(REQUEST);

      switchAccount('w2:u2');
      api.list.mockResolvedValueOnce([]);
      const library = await manager.refreshLibrary();

      expect(library.links).toEqual({});
      expect((await store.getLinks()).p1).toMatchObject({ status: 'live', account: 'w1:u1' });

      switchAccount('w1:u1');
      expect((await manager.getLibrary()).links.p1).toMatchObject({ status: 'live' });
    });

    it('doesn’t copy another account’s link', async () => {
      const { manager, clipboard, switchAccount } = setup();
      await manager.share(REQUEST);
      clipboard.mockClear();

      switchAccount('w2:u2');
      expect(await manager.copyLink('p1')).toBe(false);
      expect(clipboard).not.toHaveBeenCalled();

      switchAccount(null);
      expect(await manager.copyLink('p1')).toBe(true);
    });

    it('resumes and discards the signed-in account’s upload for a project, past another account’s', async () => {
      const { manager, api, store } = setup();
      const base = {
        sizeBytes: 25,
        mtimeMs: 1000,
        projectId: 'p1',
        title: 'Demo',
        durationS: 30,
        contentType: 'video/mp4' as const,
      };
      await store.putUpload({
        ...base,
        shareId: 'theirs',
        filePath: '/exports/a.mp4',
        account: 'w2:u2',
      });
      await store.putUpload({
        ...base,
        shareId: 'mine',
        filePath: '/exports/demo.mp4',
        account: 'w1:u1',
      });

      expect((await manager.resumeProject('p1')).status).toBe('done');
      expect(api.resume).toHaveBeenCalledWith('mine');

      await store.putUpload({
        ...base,
        shareId: 'mine2',
        filePath: '/exports/demo.mp4',
        account: 'w1:u1',
      });
      expect(await manager.discardPending('p1')).toEqual({ ok: true });
      expect(api.remove).toHaveBeenCalledWith('mine2');
      expect(api.remove).not.toHaveBeenCalledWith('theirs');
    });

    it('ignores a list that came back after the account changed', async () => {
      const { manager, api, store, switchAccount } = setup({ account: 'w1:u1' });
      await store.setLink('p2', {
        shareId: 'b1',
        title: 'Theirs',
        watchUrl: 'https://director.screenforge.co/s/b1',
        expiresAt: null,
        status: 'live',
        sharedAt: null,
        account: 'w2:u2',
      });
      api.list.mockImplementationOnce(async () => {
        // Signed out of w1 and into w2 while w1's list was on its way.
        switchAccount('w2:u2');
        return [];
      });

      await manager.refreshLibrary();

      expect((await store.getLinks()).p2.status).toBe('live');
    });

    it('never asks Director to remove another account’s link', async () => {
      const { manager, api, switchAccount } = setup();
      await manager.share(REQUEST);

      switchAccount('w2:u2');
      expect(await manager.removeLink('p1')).toEqual({ ok: false, error: 'signed-out' });
      expect(api.remove).not.toHaveBeenCalled();
    });

    it('neither resumes nor deletes another account’s upload, and deletes it once that account is back', async () => {
      const { manager, api, store, switchAccount } = setup({ account: 'w2:u2' });
      await store.putUpload({
        shareId: 'old',
        filePath: '/exports/demo.mp4',
        sizeBytes: 25,
        mtimeMs: 1000,
        projectId: 'p1',
        title: 'Demo',
        durationS: 30,
        contentType: 'video/mp4',
        account: 'w1:u1',
      });
      expect(await manager.canResume('/exports/demo.mp4')).toBe(false);

      expect((await manager.share(REQUEST)).status).toBe('done');
      expect(api.resume).not.toHaveBeenCalled();
      expect(api.remove).not.toHaveBeenCalledWith('old');
      expect(await store.getDeletions()).toEqual([{ shareId: 'old', account: 'w1:u1' }]);

      switchAccount('w1:u1');
      await manager.refreshLibrary();
      expect(api.remove).toHaveBeenCalledWith('old');
      expect(await store.getDeletions()).toEqual([]);
    });
  });

  describe('library', () => {
    it('drops an unsafe watch link already saved, in the library and when copying', async () => {
      const { manager, api, store, clipboard } = setup();
      await store.setLink('p1', {
        shareId: 'sh1',
        title: 'Demo',
        watchUrl: 'javascript:alert(1)',
        expiresAt: '2026-12-06T10:00:00.000Z',
        status: 'live',
        sharedAt: null,
      });
      expect((await manager.getLibrary()).links.p1?.watchUrl).toBeNull();
      expect(await manager.copyLink('p1')).toBe(false);
      expect(clipboard).not.toHaveBeenCalled();

      api.list.mockResolvedValueOnce([share({ watchUrl: 'file:///etc/passwd' })]);
      expect((await manager.refreshLibrary()).links.p1?.watchUrl).toBeNull();
    });

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
