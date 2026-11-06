import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadProjectBundle } from './project-download';

const MANIFEST = {
  demoId: 'd1',
  name: 'Invite a teammate',
  expiresInSeconds: 900,
  files: [
    { path: 'project.json', url: 'https://r2.test/p' },
    { path: 'recording.mp4', url: 'https://r2.test/r' },
    { path: 'narration.wav', url: 'https://r2.test/n' },
  ],
};

const body = (text: string) => new Response(text, { status: 200 });

describe('downloadProjectBundle', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-dl-'));
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it("asks Director for the demo's project and saves each file under its bundle name", async () => {
    const request = vi.fn().mockResolvedValue(MANIFEST);
    const fetch = vi.fn((url: string) => Promise.resolve(body(`bytes of ${url}`)));
    const progress = vi.fn();

    const result = await downloadProjectBundle({
      demoId: 'd1',
      request,
      fetch,
      dir,
      onProgress: progress,
    });

    expect(request).toHaveBeenCalledWith('/desktop/demos/d1/project');
    expect(result).toEqual({
      projectFile: path.join(dir, 'project.json'),
      name: 'Invite a teammate',
    });
    expect(await fs.readFile(path.join(dir, 'recording.mp4'), 'utf8')).toBe(
      'bytes of https://r2.test/r',
    );
    expect(await fs.readFile(path.join(dir, 'narration.wav'), 'utf8')).toBe(
      'bytes of https://r2.test/n',
    );
    expect(progress).toHaveBeenLastCalledWith({ filesDone: 3, filesTotal: 3 });
  });

  it('ignores any file that is not part of a project bundle', async () => {
    const request = vi.fn().mockResolvedValue({
      ...MANIFEST,
      files: [...MANIFEST.files, { path: '../../.bashrc', url: 'https://r2.test/evil' }],
    });
    const fetch = vi.fn(() => Promise.resolve(body('x')));
    await downloadProjectBundle({ demoId: 'd1', request, fetch, dir });
    expect(fetch).not.toHaveBeenCalledWith('https://r2.test/evil');
    expect(await fs.readdir(dir)).toEqual(['narration.wav', 'project.json', 'recording.mp4']);
  });

  it('only downloads from https', async () => {
    const request = vi.fn().mockResolvedValue({
      ...MANIFEST,
      files: [{ path: 'project.json', url: 'file:///etc/passwd' }, MANIFEST.files[1]],
    });
    const fetch = vi.fn(() => Promise.resolve(body('x')));
    await expect(downloadProjectBundle({ demoId: 'd1', request, fetch, dir })).rejects.toThrow(
      /project file/i,
    );
  });

  it('fails when a download fails', async () => {
    const request = vi.fn().mockResolvedValue(MANIFEST);
    const fetch = vi.fn(() => Promise.resolve(new Response('no', { status: 403 })));
    await expect(downloadProjectBundle({ demoId: 'd1', request, fetch, dir })).rejects.toThrow(
      /403/,
    );
  });

  it('url-encodes the demo id', async () => {
    const request = vi.fn().mockRejectedValue(new Error('stop'));
    await downloadProjectBundle({ demoId: 'a/b', request, fetch: vi.fn(), dir }).catch(
      () => undefined,
    );
    expect(request).toHaveBeenCalledWith('/desktop/demos/a%2Fb/project');
  });
});
