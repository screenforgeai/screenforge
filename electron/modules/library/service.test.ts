// @vitest-environment node

// A fresh recording lives in the temp folder; saving it copies it into the
// library. The editor keeps playing the temp file, so every autosave (5 s after
// each edit) passed the temp path again and copied the whole video again:
// minutes of disk work per save for a long take, twice over when the mic was
// merged into it (audioPath is then the same file). These run the real service.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedProject, StoredProjectLike } from '../../../src/types/index';

const electronMock = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => electronMock.userData } }));

const fsSpies = vi.hoisted(() => ({ copyFile: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  fsSpies.copyFile.mockImplementation(actual.copyFile);
  return { ...actual, default: { ...actual, copyFile: fsSpies.copyFile } };
});

import { getProjects, saveProject } from './service';
import { normalizeSavedProject } from '../../../src/lib/effects/frame';

let tempDir: string;

const project = (result: Partial<SavedProject['result']>): SavedProject =>
  normalizeSavedProject({
    id: 'proj-1',
    name: 'Long take',
    result: {
      filePath: '',
      mouseData: [],
      duration: 3600,
      startTime: 1_000,
      recordingArea: { x: 0, y: 0, width: 1920, height: 1080 },
      ...result,
    },
    zoomClips: [],
    savedAt: '2026-11-27T00:00:00.000Z',
    thumbnail: '',
  } as StoredProjectLike);

const copiesInto = (dir: string) =>
  fsSpies.copyFile.mock.calls.filter(([, dest]) => String(dest).startsWith(dir));

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-library-'));
  electronMock.userData = path.join(tempDir, 'userData');
  fsSpies.copyFile.mockClear();
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('saveProject', () => {
  it('copies a fresh recording into the library once, not on every autosave', async () => {
    const recording = path.join(tempDir, 'screenforge-1.mp4');
    await fs.writeFile(recording, 'video-bytes');

    const first = await saveProject(project({ filePath: recording }));
    // The editor still holds the temp path, so autosaves pass it again.
    await saveProject(project({ filePath: recording }));
    await saveProject(project({ filePath: recording }));

    expect(copiesInto(electronMock.userData)).toHaveLength(1);
    expect(first.result.filePath).toBe(
      path.join(electronMock.userData, 'projects', 'assets', 'proj-1.mp4'),
    );
    expect(await fs.readFile(first.result.filePath, 'utf8')).toBe('video-bytes');
  });

  it('copies again when the recording was replaced (record more)', async () => {
    const recording = path.join(tempDir, 'screenforge-1.mp4');
    await fs.writeFile(recording, 'take-one');
    await saveProject(project({ filePath: recording }));

    const merged = path.join(tempDir, 'screenforge-merged.mp4');
    await fs.writeFile(merged, 'take-one-and-two');
    const saved = await saveProject(project({ filePath: merged }));

    expect(copiesInto(electronMock.userData)).toHaveLength(2);
    expect(await fs.readFile(saved.result.filePath, 'utf8')).toBe('take-one-and-two');
  });

  it('copies again when an earlier copy was cut short', async () => {
    const recording = path.join(tempDir, 'screenforge-1.mp4');
    await fs.writeFile(recording, 'video-bytes');
    const saved = await saveProject(project({ filePath: recording }));
    await fs.writeFile(saved.result.filePath, 'video');

    await saveProject(project({ filePath: recording }));

    expect(copiesInto(electronMock.userData)).toHaveLength(2);
    expect(await fs.readFile(saved.result.filePath, 'utf8')).toBe('video-bytes');
  });

  it('does not copy the video a second time when the mic was merged into it', async () => {
    const merged = path.join(tempDir, 'screenforge-merged.mp4');
    await fs.writeFile(merged, 'video-with-mic');

    const saved = await saveProject(project({ filePath: merged, audioPath: merged }));

    expect(copiesInto(electronMock.userData)).toHaveLength(1);
    expect(saved.result.audioPath).toBe(saved.result.filePath);

    // Re-saving the reopened project keeps pointing both at the one asset.
    const resaved = await saveProject(saved);
    expect(copiesInto(electronMock.userData)).toHaveLength(1);
    expect(resaved.result.audioPath).toBe(resaved.result.filePath);
    const assets = await fs.readdir(path.join(electronMock.userData, 'projects', 'assets'));
    expect(assets).toEqual(['proj-1.mp4']);
  });

  it('still copies a separate audio file', async () => {
    const recording = path.join(tempDir, 'screenforge-1.mp4');
    const audio = path.join(tempDir, 'screenforge-audio-1.webm');
    await fs.writeFile(recording, 'video');
    await fs.writeFile(audio, 'audio');

    const saved = await saveProject(project({ filePath: recording, audioPath: audio }));

    expect(saved.result.audioPath).toBe(
      path.join(electronMock.userData, 'projects', 'assets', 'proj-1-audio.webm'),
    );
    expect(await fs.readFile(String(saved.result.audioPath), 'utf8')).toBe('audio');
  });

  it('writes the project so it can be listed again', async () => {
    const recording = path.join(tempDir, 'screenforge-1.mp4');
    await fs.writeFile(recording, 'video');
    await saveProject(project({ filePath: recording }));

    const projects = await getProjects();

    expect(projects.map((p) => p.id)).toEqual(['proj-1']);
    const files = await fs.readdir(path.join(electronMock.userData, 'projects'));
    // Written through a temp file and renamed, so a crash mid-save can't corrupt it.
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
