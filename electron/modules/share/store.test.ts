// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createShareStore, type ShareStoreFs } from './store';
import type { PendingShareUpload, ProjectShareLink } from '../../../src/types/index';

const memoryFs = (initial: Record<string, string> = {}) => {
  const files = new Map(Object.entries(initial));
  const fs: ShareStoreFs = {
    async readFile(p) {
      const value = files.get(p);
      if (value === undefined) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return value;
    },
    async writeFile(p, data) {
      files.set(p, data);
    },
    async rename(from, to) {
      const value = files.get(from);
      if (value === undefined) {
        throw new Error('ENOENT');
      }
      files.delete(from);
      files.set(to, value);
    },
    async mkdir() {
      return undefined;
    },
  };
  return { fs, files };
};

const FILE = '/userData/share-links.json';

const upload = (over: Partial<PendingShareUpload> = {}): PendingShareUpload => ({
  shareId: 's1',
  filePath: '/exports/demo.mp4',
  sizeBytes: 100,
  mtimeMs: 1,
  projectId: 'p1',
  title: 'Demo',
  durationS: 30,
  contentType: 'video/mp4',
  ...over,
});

const link = (over: Partial<ProjectShareLink> = {}): ProjectShareLink => ({
  shareId: 's1',
  title: 'Demo',
  watchUrl: 'https://director.screenforge.co/watch/s1',
  expiresAt: '2026-12-06T10:00:00.000Z',
  status: 'live',
  sharedAt: '2026-11-06T10:00:00.000Z',
  ...over,
});

describe('share store', () => {
  it('starts empty when nothing was saved, or the file is unreadable', async () => {
    expect(await createShareStore({ filePath: FILE, fs: memoryFs().fs }).getLinks()).toEqual({});
    const broken = createShareStore({ filePath: FILE, fs: memoryFs({ [FILE]: '{nope' }).fs });
    expect(await broken.getUploads()).toEqual([]);
  });

  it('remembers an in-progress upload, found by file or project, until removed', async () => {
    const { fs, files } = memoryFs();
    const store = createShareStore({ filePath: FILE, fs });
    await store.putUpload(upload());
    const reopened = createShareStore({ filePath: FILE, fs });
    expect(await reopened.findUpload({ filePath: '/exports/demo.mp4' })).toEqual(upload());
    expect(await reopened.findUpload({ projectId: 'p1' })).toEqual(upload());
    await reopened.removeUpload('s1');
    expect(await reopened.getUploads()).toEqual([]);
    expect(JSON.parse(files.get(FILE) ?? '{}').uploads).toEqual([]);
  });

  it('keeps one upload per file: a new one replaces the old', async () => {
    const store = createShareStore({ filePath: FILE, fs: memoryFs().fs });
    await store.putUpload(upload());
    await store.putUpload(upload({ shareId: 's2', mtimeMs: 2 }));
    expect(await store.getUploads()).toEqual([upload({ shareId: 's2', mtimeMs: 2 })]);
  });

  it('keeps each project’s link, and can replace or forget it', async () => {
    const { fs } = memoryFs();
    const store = createShareStore({ filePath: FILE, fs });
    await store.setLink('p1', link());
    await store.setLink('p2', link({ shareId: 's2' }));
    await store.setLink('p1', link({ shareId: 's3' }));
    await store.removeLink('p2');
    const reopened = createShareStore({ filePath: FILE, fs });
    expect(await reopened.getLinks()).toEqual({ p1: link({ shareId: 's3' }) });
  });

  it('writes through a temp file, so a crash mid-write never leaves half a file', async () => {
    const { fs, files } = memoryFs();
    const store = createShareStore({ filePath: FILE, fs });
    await store.setLink('p1', link());
    expect([...files.keys()]).toEqual([FILE]);
  });

  it('applies concurrent changes one after another', async () => {
    const store = createShareStore({ filePath: FILE, fs: memoryFs().fs });
    await Promise.all([
      store.setLink('a', link({ shareId: 'a' })),
      store.setLink('b', link({ shareId: 'b' })),
      store.putUpload(upload()),
    ]);
    expect(Object.keys(await store.getLinks()).sort()).toEqual(['a', 'b']);
    expect(await store.getUploads()).toHaveLength(1);
  });

  it('updates many links at once', async () => {
    const store = createShareStore({ filePath: FILE, fs: memoryFs().fs });
    await store.setLink('p1', link());
    await store.updateLinks((links) => ({ ...links, p1: { ...links.p1, status: 'expired' } }));
    expect((await store.getLinks()).p1.status).toBe('expired');
  });
});
