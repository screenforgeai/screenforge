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
  it('starts empty when nothing was saved', async () => {
    expect(await createShareStore({ filePath: FILE, fs: memoryFs().fs }).getLinks()).toEqual({});
  });

  it('sets a corrupt file aside, rather than overwriting it, and starts empty', async () => {
    const { fs, files } = memoryFs({ [FILE]: '{nope' });
    const broken = createShareStore({ filePath: FILE, fs });
    expect(await broken.getUploads()).toEqual([]);
    expect([...files.entries()]).toEqual([[`${FILE}.corrupt`, '{nope']]);
  });

  it('never replaces a file it could not read with an empty one', async () => {
    const { fs, files } = memoryFs({ [FILE]: JSON.stringify({ links: { p1: link() } }) });
    const readFile = fs.readFile;
    let failures = 1;
    fs.readFile = async (p, encoding) => {
      if (failures-- > 0) {
        throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      }
      return readFile(p, encoding);
    };
    const store = createShareStore({ filePath: FILE, fs });

    await expect(store.getLinks()).rejects.toThrow('EBUSY');
    await expect(store.putUpload(upload())).resolves.toBeUndefined();

    const saved = JSON.parse(files.get(FILE) ?? '');
    expect(saved.links.p1).toMatchObject({ shareId: 's1' });
    expect(saved.uploads).toEqual([upload()]);
  });

  it('loads the file once for reads that start together, so none overwrites a later change', async () => {
    const { fs, files } = memoryFs({ [FILE]: JSON.stringify({ links: {} }) });
    let reads = 0;
    const readFile = fs.readFile;
    fs.readFile = async (p, encoding) => {
      reads++;
      return readFile(p, encoding);
    };
    const store = createShareStore({ filePath: FILE, fs });

    const [links, uploads] = await Promise.all([
      store.getLinks(),
      store.getUploads(),
      store.putUpload(upload()),
    ]);

    expect(reads).toBe(1);
    expect(links).toEqual({});
    expect(uploads).toEqual([]);
    expect(await store.getUploads()).toEqual([upload()]);
    expect(JSON.parse(files.get(FILE) ?? '').uploads).toEqual([upload()]);
  });

  it('answers reads and writes in the order they were asked', async () => {
    const { fs } = memoryFs();
    const store = createShareStore({ filePath: FILE, fs });
    const order: string[] = [];

    await Promise.all([
      store.getUploads().then(() => order.push('read 1')),
      store.putUpload(upload()).then(() => order.push('write')),
      store.getUploads().then((u) => order.push(`read 2 (${u.length})`)),
    ]);

    expect(order).toEqual(['read 1', 'write', 'read 2 (1)']);
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
