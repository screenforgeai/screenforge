// @vitest-environment node

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SerializedChunk } from '../../../src/types';
import {
  ChunkCache,
  ChunkCacheError,
  ChunkRunWriter,
  assertChunkKey,
  buildConcatArgs,
  buildConcatList,
  checkFrameTimes,
  chunkContainerFor,
  chunkIndexForTimestamp,
  chunkNamespaceFor,
  parseFrameTimes,
  streamSignatureFor,
  type RunSpec,
  type WrittenChunk,
} from './chunkCache';
import type { ExportVideoMuxer } from './videoMuxer';

const FPS = 30;
const frameMicros = (frame: number) => Math.round((frame / FPS) * 1_000_000);

function packet(frame: number, runStart: number, key: boolean): SerializedChunk {
  return {
    data: new ArrayBuffer(4),
    type: key ? 'key' : 'delta',
    timestamp: frameMicros(frame - runStart),
    duration: frameMicros(1),
  };
}

/** Packets for frames [start, end) of a run, with a keyframe every second. */
function packetsFor(run: RunSpec, start = run.startFrame, end = run.endFrame): SerializedChunk[] {
  const out: SerializedChunk[] = [];
  for (let frame = start; frame < end; frame += 1) {
    out.push(packet(frame, run.startFrame, frame % FPS === 0));
  }
  return out;
}

interface FakeMuxer {
  path: string;
  packets: SerializedChunk[];
  finalized: boolean;
  cancelled: boolean;
}

function fakeMuxerFactory(made: FakeMuxer[]) {
  return async ({ videoPath }: { videoPath: string }): Promise<ExportVideoMuxer> => {
    const record: FakeMuxer = { path: videoPath, packets: [], finalized: false, cancelled: false };
    made.push(record);
    return {
      videoPath,
      async writeEncodedChunks(chunks) {
        record.packets.push(...chunks);
      },
      async finalize() {
        record.finalized = true;
        await fs.writeFile(videoPath, `frames:${record.packets.length}`);
        return videoPath;
      },
      async cancel() {
        record.cancelled = true;
      },
    };
  };
}

const run: RunSpec = {
  startFrame: 60,
  endFrame: 180,
  chunks: [
    { key: 'k1', startFrame: 60, endFrame: 120 },
    { key: 'k2', startFrame: 120, endFrame: 180 },
  ],
};

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chunk-cache-test-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('helpers', () => {
  it('maps every export format to a chunk container', () => {
    expect(chunkContainerFor('mp4')).toBe('mp4');
    expect(chunkContainerFor('mov')).toBe('mov');
    expect(chunkContainerFor('webm')).toBe('webm');
    expect(chunkContainerFor('gif')).toBe('mp4');
  });

  it('finds the chunk for a run-relative timestamp', () => {
    expect(chunkIndexForTimestamp(run, FPS, 0)).toBe(0);
    expect(chunkIndexForTimestamp(run, FPS, frameMicros(59))).toBe(0);
    expect(chunkIndexForTimestamp(run, FPS, frameMicros(60))).toBe(1);
    expect(() => chunkIndexForTimestamp(run, FPS, frameMicros(120))).toThrow(ChunkCacheError);
  });

  it('changes the namespace when the source file or app version changes', () => {
    const base = {
      recordingPath: '/r.mp4',
      recordingSize: 10,
      recordingMtimeMs: 1,
      appVersion: '1.0.0',
    };
    const ns = chunkNamespaceFor(base);
    expect(chunkNamespaceFor({ ...base })).toBe(ns);
    expect(chunkNamespaceFor({ ...base, recordingMtimeMs: 2 })).not.toBe(ns);
    expect(chunkNamespaceFor({ ...base, appVersion: '1.0.1' })).not.toBe(ns);
  });

  it('gives different encoder outputs different stream signatures', () => {
    const config = { codec: 'avc1.640034', codedWidth: 1920, codedHeight: 1080 };
    const a = streamSignatureFor({ ...config, description: new Uint8Array([1, 2]).buffer }, 30);
    expect(streamSignatureFor({ ...config, description: new Uint8Array([1, 2]).buffer }, 30)).toBe(
      a,
    );
    expect(
      streamSignatureFor({ ...config, description: new Uint8Array([1, 3]).buffer }, 30),
    ).not.toBe(a);
    expect(
      streamSignatureFor({ ...config, description: new Uint8Array([1, 2]).buffer }, 60),
    ).not.toBe(a);
  });

  it('writes a concat list with exact chunk lengths, surviving quotes and Windows paths', () => {
    expect(
      buildConcatList([
        { file: "C:\\Users\\o'neil\\a.mp4", durationSeconds: 2 },
        { file: '/tmp/b.mp4', durationSeconds: 1.5 },
      ]),
    ).toBe(
      "file 'C:/Users/o'\\''neil/a.mp4'\nduration 2.000000\nfile '/tmp/b.mp4'\nduration 1.500000\n",
    );
    expect(buildConcatArgs('/l.txt', '/o.mp4')).toEqual([
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      '/l.txt',
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '/o.mp4',
    ]);
  });

  it('reads frame times from framemd5 output and checks every frame is on time', () => {
    const md5 = [
      '#format: frame checksums',
      '#tb 0: 1/90000',
      '#stream#, dts,        pts, duration,     size, hash',
      '0,          0,          0,     3000,      100, aa',
      '0,       3000,       3000,     3000,      100, bb',
      '0,       6000,       6000,     3000,      100, cc',
    ].join('\n');
    const times = parseFrameTimes(md5);
    expect(times).toEqual([0, 3000 / 90000, 6000 / 90000]);
    expect(checkFrameTimes(times, 3, 30)).toBeNull();
    expect(checkFrameTimes(times, 4, 30)).toBe('has 3 of 4 frames');
    // The bug this guards against: the next chunk starting a frame early.
    expect(checkFrameTimes([0, 1 / 30, 1 / 30 + 0.0001], 3, 30)).toMatch(/^frame 2 is at/);
  });
});

describe('assertChunkKey', () => {
  it('accepts a 128-bit hex key', () => {
    expect(() => assertChunkKey('0123456789abcdef0123456789abcdef')).not.toThrow();
  });

  it.each([
    ['a path', '../../etc/passwd'],
    ['a short key', 'abc'],
    ['upper case', '0123456789ABCDEF0123456789ABCDEF'],
    ['not a string', 42],
  ])('refuses %s', (_label, key) => {
    expect(() => assertChunkKey(key)).toThrow(ChunkCacheError);
  });

  it('keeps cache paths inside the cache', () => {
    const cache = new ChunkCache(os.tmpdir());
    expect(() => cache.chunkPath('ns', '../escape', 'mp4')).toThrow('Invalid chunk key');
  });
});

describe('ChunkRunWriter', () => {
  it('splits a run into one file per chunk with zero-based timestamps', async () => {
    const made: FakeMuxer[] = [];
    const completed: WrittenChunk[] = [];
    const writer = new ChunkRunWriter({
      dir,
      container: 'mp4',
      fps: FPS,
      decoderConfig: null,
      run,
      createMuxer: fakeMuxerFactory(made),
      onChunkComplete: async (chunk) => {
        completed.push(chunk);
      },
    });
    const packets = packetsFor(run);
    // Arrives in IPC batches that straddle the chunk boundary.
    await writer.write(packets.slice(0, 50));
    await writer.write(packets.slice(50, 70));
    expect(completed.map((c) => c.key)).toEqual(['k1']);
    await writer.write(packets.slice(70));
    await writer.finish();

    expect(completed.map((c) => [c.key, c.frames])).toEqual([
      ['k1', 60],
      ['k2', 60],
    ]);
    expect(made).toHaveLength(2);
    expect(made.every((m) => m.finalized)).toBe(true);
    expect(made[0].packets[0].timestamp).toBe(0);
    expect(made[1].packets[0].timestamp).toBe(0);
    expect(made[1].packets[0].type).toBe('key');
    expect(made[1].packets.at(-1)?.timestamp).toBe(frameMicros(59));
  });

  it('rejects a chunk that does not start on a keyframe', async () => {
    const writer = new ChunkRunWriter({
      dir,
      container: 'mp4',
      fps: FPS,
      decoderConfig: null,
      run,
      createMuxer: fakeMuxerFactory([]),
    });
    const packets = packetsFor(run);
    packets[60] = { ...packets[60], type: 'delta' };
    await expect(writer.write(packets)).rejects.toThrow('does not start on a keyframe');
  });

  it('refuses to finish a chunk with missing frames', async () => {
    const completed: WrittenChunk[] = [];
    const writer = new ChunkRunWriter({
      dir,
      container: 'mp4',
      fps: FPS,
      decoderConfig: null,
      run,
      createMuxer: fakeMuxerFactory([]),
      onChunkComplete: async (chunk) => {
        completed.push(chunk);
      },
    });
    await writer.write(packetsFor(run, 60, 175));
    await expect(writer.finish()).rejects.toThrow('has 55 of 60 frames');
    expect(completed.map((c) => c.key)).toEqual(['k1']);
  });

  it('cancels without completing the open chunk', async () => {
    const made: FakeMuxer[] = [];
    const completed: WrittenChunk[] = [];
    const writer = new ChunkRunWriter({
      dir,
      container: 'mp4',
      fps: FPS,
      decoderConfig: null,
      run,
      createMuxer: fakeMuxerFactory(made),
      onChunkComplete: async (chunk) => {
        completed.push(chunk);
      },
    });
    await writer.write(packetsFor(run, 60, 100));
    await writer.cancel();
    expect(completed).toEqual([]);
    expect(made[0].cancelled).toBe(true);
  });
});

describe('ChunkCache', () => {
  // Real keys are 128-bit hex; name them for readability.
  const K = (name: string) => createHash('md5').update(name).digest('hex');

  async function storeChunk(
    cache: ChunkCache,
    ns: string,
    key: string,
    frames: number,
    signature = 's',
  ) {
    const scratch = await cache.createScratchDir(ns);
    const filePath = path.join(scratch, `${key}.mp4`);
    await fs.writeFile(filePath, Buffer.alloc(1000));
    await cache.put(ns, { key, filePath, frames }, 'mp4', FPS, signature);
  }

  it('reports only complete, matching chunks as cached', async () => {
    const cache = new ChunkCache(dir);
    await storeChunk(cache, 'ns', K('k1'), 60);
    const chunks = [
      { key: K('k1'), startFrame: 0, endFrame: 60 },
      { key: K('k2'), startFrame: 60, endFrame: 120 },
    ];
    expect(await cache.lookup('ns', chunks, 'mp4', FPS)).toEqual([true, false]);
    expect(await cache.lookup('ns', chunks, 'webm', FPS)).toEqual([false, false]);
    expect(await cache.lookup('ns', chunks, 'mp4', 60)).toEqual([false, false]);
    expect(await cache.lookup('other', chunks, 'mp4', FPS)).toEqual([false, false]);
    // A chunk whose file vanished is not cached.
    await fs.rm(cache.chunkPath('ns', K('k1'), 'mp4'));
    expect(await cache.lookup('ns', chunks, 'mp4', FPS)).toEqual([false, false]);
  });

  it('resolves chunks for joining and refuses mixed encoder output', async () => {
    const cache = new ChunkCache(dir);
    await storeChunk(cache, 'ns', K('a'), 60, 'sig1');
    await storeChunk(cache, 'ns', K('b'), 30, 'sig1');
    await storeChunk(cache, 'ns', K('c'), 60, 'sig2');
    const joined = await cache.resolveForJoin('ns', [K('a'), K('b')], 'mp4');
    expect(joined.frames).toBe(90);
    expect(joined.files).toEqual([
      cache.chunkPath('ns', K('a'), 'mp4'),
      cache.chunkPath('ns', K('b'), 'mp4'),
    ]);
    await expect(cache.resolveForJoin('ns', [K('a'), K('c')], 'mp4')).rejects.toThrow(
      'different encoder',
    );
    await expect(cache.resolveForJoin('ns', [K('a'), K('missing')], 'mp4')).rejects.toThrow(
      'is missing',
    );
  });

  it('evicts least-recently-used chunks over the cap and keeps protected ones', async () => {
    const cache = new ChunkCache(dir, 2500);
    for (const [i, key] of [K('old'), K('mid'), K('new')].entries()) {
      await storeChunk(cache, 'ns', key, 60);
      const when = new Date(Date.now() - (3 - i) * 60_000);
      await fs.utimes(cache.chunkPath('ns', key, 'mp4'), when, when);
    }
    await cache.evict(new Set([K('old')]));
    const chunks = [K('old'), K('mid'), K('new')].map((key) => ({
      key,
      startFrame: 0,
      endFrame: 60,
    }));
    expect(await cache.lookup('ns', chunks, 'mp4', FPS)).toEqual([true, false, true]);
  });
});
