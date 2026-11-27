// @vitest-environment node

// Mic, camera and Wayland screen captures are MediaRecorder streams in the
// toolbar. They used to be held in memory for the whole take and sent over IPC
// as one ArrayBuffer at stop: for an hour of camera that is ~2 GB, copied three
// times, which ran out of time (or memory) while the editor sat on
// "Processing". These check the chunks are written to disk as they arrive.

import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({ tempDir: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => electronMock.tempDir },
}));
vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  abortCaptureStream,
  appendCaptureStream,
  closeCaptureStream,
  openCaptureStream,
} from './capture-stream';

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

beforeAll(async () => {
  electronMock.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sf-capture-stream-'));
});

afterAll(async () => {
  await fs.rm(electronMock.tempDir, { recursive: true, force: true });
});

describe('capture streams', () => {
  it('writes chunks to a temp file in the order they were sent', async () => {
    const id = await openCaptureStream('camera');
    // Not awaited one by one: the toolbar fires them as MediaRecorder hands them over.
    await Promise.all([
      appendCaptureStream(id, bytes('one,')),
      appendCaptureStream(id, bytes('two,')),
      appendCaptureStream(id, bytes('three')),
    ]);
    const filePath = await closeCaptureStream(id);

    expect(path.dirname(filePath)).toBe(electronMock.tempDir);
    expect(path.basename(filePath)).toMatch(/^screenforge-camera-.+\.webm$/);
    expect(readFileSync(filePath, 'utf8')).toBe('one,two,three');
  });

  it('accepts typed-array views, writing only the viewed bytes', async () => {
    const id = await openCaptureStream('audio');
    const backing = new TextEncoder().encode('xxaudioxx');
    await appendCaptureStream(id, backing.subarray(2, 7));
    const filePath = await closeCaptureStream(id);

    expect(path.basename(filePath)).toMatch(/^screenforge-audio-/);
    expect(readFileSync(filePath, 'utf8')).toBe('audio');
  });

  it('finishes writes still in flight before closing', async () => {
    const id = await openCaptureStream('screen');
    void appendCaptureStream(id, bytes('late'));
    const filePath = await closeCaptureStream(id);

    expect(readFileSync(filePath, 'utf8')).toBe('late');
  });

  it('fails a stream that received nothing, and leaves no empty file behind', async () => {
    const id = await openCaptureStream('audio');
    const before = new Set(await fs.readdir(electronMock.tempDir));

    await expect(closeCaptureStream(id)).rejects.toThrow(/did not receive any data/);

    const after = await fs.readdir(electronMock.tempDir);
    expect(after.filter((name) => !before.has(name))).toEqual([]);
    expect(after.length).toBe(before.size - 1);
  });

  it('deletes the file when a stream is aborted', async () => {
    const before = await fs.readdir(electronMock.tempDir);
    const id = await openCaptureStream('camera');
    await appendCaptureStream(id, bytes('discarded'));
    expect((await fs.readdir(electronMock.tempDir)).length).toBe(before.length + 1);

    await abortCaptureStream(id);

    expect((await fs.readdir(electronMock.tempDir)).sort()).toEqual(before.sort());
  });

  it('rejects calls for a stream that is not open', async () => {
    const id = await openCaptureStream('audio');
    await appendCaptureStream(id, bytes('x'));
    await closeCaptureStream(id);

    await expect(appendCaptureStream(id, bytes('y'))).rejects.toThrow(/not open/);
    await expect(closeCaptureStream(id)).rejects.toThrow(/not open/);
    await expect(abortCaptureStream(id)).resolves.toBeUndefined();
  });
});
