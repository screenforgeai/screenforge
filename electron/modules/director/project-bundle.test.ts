import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readProjectBundle, ProjectBundleError } from './project-bundle';

const PROJECT = {
  id: 'abc',
  name: 'Invite a teammate',
  result: {
    filePath: 'recording.mp4',
    audioPath: 'narration.wav',
    mouseData: [{ type: 'move', x: 1, y: 2, timestamp: 1 }],
    duration: 12,
    startTime: 1,
    recordingArea: { x: 0, y: 0, width: 1728, height: 1080 },
    syntheticCursor: true,
  },
  zoomClips: [{ id: 'z1', start: 1, end: 3, scale: 1.8 }],
  savedAt: '2026-11-06T12:00:00.000Z',
  thumbnail: '',
  frame: { aspectRatioId: '16:9', background: { padding: 0.12 } },
  cursor: { size: 80 },
  captions: { segments: [] as unknown[], language: 'en', captionsEnabled: false },
  captureViewport: { width: 1440, height: 900 },
  captureScale: 1.2,
};

describe('readProjectBundle', () => {
  let dir: string;

  const write = async (project: unknown, files = ['recording.mp4', 'narration.wav']) => {
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project));
    for (const f of files) {
      await fs.writeFile(path.join(dir, f), 'x');
    }
    return path.join(dir, 'project.json');
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-bundle-'));
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it('resolves the bundle files next to the project file', async () => {
    const project = await readProjectBundle(await write(PROJECT));
    expect(project.result.filePath).toBe(path.join(dir, 'recording.mp4'));
    expect(project.result.audioPath).toBe(path.join(dir, 'narration.wav'));
  });

  it('keeps what the editor reads: zoom, frame, cursor, captions, synthetic cursor, capture size', async () => {
    const project = await readProjectBundle(await write(PROJECT));
    expect(project).toMatchObject({
      name: 'Invite a teammate',
      zoomClips: PROJECT.zoomClips,
      frame: PROJECT.frame,
      cursor: PROJECT.cursor,
      captions: PROJECT.captions,
      captureViewport: PROJECT.captureViewport,
      captureScale: 1.2,
    });
    expect(project.result.syntheticCursor).toBe(true);
  });

  it('opens a project without narration', async () => {
    const noAudio = {
      ...PROJECT,
      result: { ...PROJECT.result, audioPath: undefined as string | undefined },
    };
    const project = await readProjectBundle(await write(noAudio, ['recording.mp4']));
    expect(project.result.audioPath).toBeUndefined();
  });

  it('drops a narration file the bundle does not have rather than failing', async () => {
    const project = await readProjectBundle(await write(PROJECT, ['recording.mp4']));
    expect(project.result.audioPath).toBeUndefined();
  });

  it.each([
    ['an absolute path', '/etc/passwd'],
    ['a path out of the bundle', '../recording.mp4'],
    ['a nested path', 'sub/recording.mp4'],
  ])('refuses a recording at %s', async (_label, filePath) => {
    const bad = { ...PROJECT, result: { ...PROJECT.result, filePath } };
    await expect(readProjectBundle(await write(bad))).rejects.toMatchObject({
      reason: 'invalid',
    });
  });

  it('refuses a bundle whose recording is missing', async () => {
    await expect(readProjectBundle(await write(PROJECT, []))).rejects.toMatchObject({
      reason: 'missing-recording',
    });
  });

  it.each([
    ['not JSON', 'nope'],
    ['no recording result', JSON.stringify({ id: 'x', name: 'y' })],
    [
      'no cursor data',
      JSON.stringify({ ...PROJECT, result: { ...PROJECT.result, mouseData: 'x' } }),
    ],
  ])('refuses a project file that is %s', async (_label, raw) => {
    await fs.writeFile(path.join(dir, 'project.json'), raw);
    await fs.writeFile(path.join(dir, 'recording.mp4'), 'x');
    const err = await readProjectBundle(path.join(dir, 'project.json')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProjectBundleError);
    expect(err).toMatchObject({ reason: 'invalid' });
  });
});
