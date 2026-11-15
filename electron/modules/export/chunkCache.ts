/**
 * Chunk cache for chunked export.
 *
 * Rendered chunks are stored per recording (a namespace derived from the
 * source files and the app version) under their content key. A chunk only
 * enters the cache once it is complete: every frame was written and it starts
 * on a keyframe. Joining checks that every chunk came from an encoder with
 * the same output parameters before concatenating them without re-encoding.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ExportChunkSpec,
  ExportFormat,
  ExportRunSpec,
  SerializedChunk,
  SerializedDecoderConfig,
} from '../../../src/types/index';
import { createExportVideoMuxer, type ExportVideoMuxer } from './videoMuxer';

export const CHUNK_CACHE_VERSION = 1;
export const DEFAULT_CHUNK_CACHE_MAX_BYTES = 4 * 1024 ** 3;

export type ChunkContainer = 'mp4' | 'mov' | 'webm';

/** GIF exports render through a temporary MP4. */
export function chunkContainerFor(format: ExportFormat): ChunkContainer {
  if (format === 'webm') {
    return 'webm';
  }
  return format === 'mov' ? 'mov' : 'mp4';
}

/** The IPC contracts, so the cache and its callers stay in step. */
export type ChunkSpec = ExportChunkSpec;
export type RunSpec = ExportRunSpec;

/** Content keys are 128-bit hex hashes (see chunkKeys.ts). */
const CHUNK_KEY_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Keys arrive over IPC and name files, so anything that is not a content key
 * (e.g. "../x") is refused before it reaches the filesystem.
 */
export function assertChunkKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !CHUNK_KEY_PATTERN.test(key)) {
    throw new ChunkCacheError('Invalid chunk key');
  }
}

export interface ChunkMeta {
  version: number;
  key: string;
  container: ChunkContainer;
  fps: number;
  frames: number;
  /** Identifies the encoder output parameters; chunks only join when equal. */
  streamSignature: string;
  bytes: number;
}

export class ChunkCacheError extends Error {}

export function streamSignatureFor(config: SerializedDecoderConfig | null, fps: number): string {
  const hash = createHash('sha1');
  hash.update(`${config?.codec ?? 'unknown'}|${config?.codedWidth}x${config?.codedHeight}|${fps}|`);
  if (config?.description) {
    hash.update(Buffer.from(config.description));
  }
  return hash.digest('hex');
}

export interface NamespaceParts {
  recordingPath: string;
  recordingSize: number | null;
  recordingMtimeMs: number | null;
  cameraPath?: string | null;
  cameraSize?: number | null;
  cameraMtimeMs?: number | null;
  appVersion: string;
}

export function chunkNamespaceFor(parts: NamespaceParts): string {
  return createHash('sha1')
    .update(JSON.stringify({ v: CHUNK_CACHE_VERSION, ...parts }))
    .digest('hex')
    .slice(0, 24);
}

/** Which chunk of a run a packet belongs to, from its run-relative timestamp. */
export function chunkIndexForTimestamp(run: RunSpec, fps: number, timestampMicros: number): number {
  const frame = run.startFrame + Math.round((timestampMicros * fps) / 1_000_000);
  const index = run.chunks.findIndex((c) => frame >= c.startFrame && frame < c.endFrame);
  if (index < 0) {
    throw new ChunkCacheError(`Encoded frame ${frame} is outside the run being rendered`);
  }
  return index;
}

type MuxerFactory = typeof createExportVideoMuxer;

export interface WrittenChunk {
  key: string;
  filePath: string;
  frames: number;
}

/**
 * Splits one encoder session's packets into one file per chunk, each with
 * timestamps starting at zero. Each chunk is handed to `onChunkComplete` as
 * soon as it is closed with all its frames, so stopping a long run keeps the
 * chunks it already finished.
 */
export class ChunkRunWriter {
  private muxer: ExportVideoMuxer | null = null;
  private currentIndex = -1;
  private readonly counts: number[];
  private readonly files: string[] = [];
  private readonly completed: boolean[];
  private closed = false;

  constructor(
    private readonly options: {
      dir: string;
      container: ChunkContainer;
      fps: number;
      decoderConfig: SerializedDecoderConfig | null;
      run: RunSpec;
      createMuxer?: MuxerFactory;
      onChunkComplete?: (chunk: WrittenChunk) => Promise<void>;
    },
  ) {
    this.counts = options.run.chunks.map(() => 0);
    this.completed = options.run.chunks.map(() => false);
  }

  async write(packets: SerializedChunk[]): Promise<void> {
    const { run, fps } = this.options;
    let group: SerializedChunk[] = [];
    let groupIndex = this.currentIndex;
    const flushGroup = async () => {
      if (group.length > 0 && this.muxer) {
        await this.muxer.writeEncodedChunks(group);
        this.counts[groupIndex] += group.length;
      }
      group = [];
    };

    for (const packet of packets) {
      const index = chunkIndexForTimestamp(run, fps, packet.timestamp);
      if (index !== this.currentIndex) {
        if (index < this.currentIndex) {
          throw new ChunkCacheError('Encoded frames arrived out of chunk order');
        }
        if (packet.type !== 'key') {
          throw new ChunkCacheError(`Chunk ${run.chunks[index].key} does not start on a keyframe`);
        }
        await flushGroup();
        await this.closeCurrent();
        await this.open(index);
        groupIndex = index;
      }
      const chunk = run.chunks[index];
      const offsetMicros = Math.round(((chunk.startFrame - run.startFrame) / fps) * 1_000_000);
      group.push({ ...packet, timestamp: packet.timestamp - offsetMicros });
    }
    await flushGroup();
  }

  /** Closes the last chunk and checks every chunk was completed. */
  async finish(): Promise<void> {
    await this.closeCurrent();
    this.closed = true;
    const { run } = this.options;
    run.chunks.forEach((chunk, i) => {
      if (!this.completed[i]) {
        throw new ChunkCacheError(
          `Chunk ${chunk.key} has ${this.counts[i]} of ${chunk.endFrame - chunk.startFrame} frames`,
        );
      }
    });
  }

  async cancel(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.muxer?.cancel().catch(() => undefined);
    this.muxer = null;
  }

  private async open(index: number): Promise<void> {
    const { dir, container, fps, decoderConfig, createMuxer } = this.options;
    const filePath = path.join(dir, `chunk-${index}-${randomUUID()}.${container}`);
    this.muxer = await (createMuxer ?? createExportVideoMuxer)({
      format: container,
      videoPath: filePath,
      decoderConfig,
      fps,
    });
    this.files[index] = filePath;
    this.currentIndex = index;
  }

  private async closeCurrent(): Promise<void> {
    if (!this.muxer) {
      return;
    }
    const muxer = this.muxer;
    this.muxer = null;
    await muxer.finalize();
    const index = this.currentIndex;
    const chunk = this.options.run.chunks[index];
    const expected = chunk.endFrame - chunk.startFrame;
    if (this.counts[index] !== expected) {
      throw new ChunkCacheError(
        `Chunk ${chunk.key} has ${this.counts[index]} of ${expected} frames`,
      );
    }
    await this.options.onChunkComplete?.({
      key: chunk.key,
      filePath: this.files[index],
      frames: expected,
    });
    this.completed[index] = true;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class ChunkCache {
  constructor(
    private readonly root: string,
    private readonly maxBytes = DEFAULT_CHUNK_CACHE_MAX_BYTES,
  ) {}

  namespaceDir(namespace: string): string {
    return path.join(this.root, namespace);
  }

  chunkPath(namespace: string, key: string, container: ChunkContainer): string {
    assertChunkKey(key);
    return path.join(this.namespaceDir(namespace), `${key}.${container}`);
  }

  private metaPath(namespace: string, key: string): string {
    assertChunkKey(key);
    return path.join(this.namespaceDir(namespace), `${key}.json`);
  }

  /** A scratch directory inside the cache, so finished chunks move in by rename. */
  async createScratchDir(namespace: string): Promise<string> {
    const dir = path.join(this.namespaceDir(namespace), `.tmp-${randomUUID()}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async readMeta(namespace: string, key: string): Promise<ChunkMeta | null> {
    try {
      const meta = JSON.parse(
        await fs.readFile(this.metaPath(namespace, key), 'utf8'),
      ) as ChunkMeta;
      return meta.version === CHUNK_CACHE_VERSION && meta.key === key ? meta : null;
    } catch {
      return null;
    }
  }

  /** Which keys have a complete chunk; refreshes their last-used time. */
  async lookup(
    namespace: string,
    chunks: ChunkSpec[],
    container: ChunkContainer,
    fps: number,
  ): Promise<boolean[]> {
    const now = new Date();
    return Promise.all(
      chunks.map(async (chunk) => {
        const meta = await this.readMeta(namespace, chunk.key);
        const file = this.chunkPath(namespace, chunk.key, container);
        const ok =
          meta !== null &&
          meta.container === container &&
          meta.fps === fps &&
          meta.frames === chunk.endFrame - chunk.startFrame &&
          (await exists(file));
        if (ok) {
          await fs.utimes(file, now, now).catch(() => undefined);
        }
        return ok;
      }),
    );
  }

  async put(
    namespace: string,
    written: WrittenChunk,
    container: ChunkContainer,
    fps: number,
    streamSignature: string,
  ): Promise<void> {
    const stat = await fs.stat(written.filePath);
    const target = this.chunkPath(namespace, written.key, container);
    await fs.rename(written.filePath, target);
    const meta: ChunkMeta = {
      version: CHUNK_CACHE_VERSION,
      key: written.key,
      container,
      fps,
      frames: written.frames,
      streamSignature,
      bytes: stat.size,
    };
    const metaTmp = `${this.metaPath(namespace, written.key)}.${randomUUID()}.tmp`;
    await fs.writeFile(metaTmp, JSON.stringify(meta));
    await fs.rename(metaTmp, this.metaPath(namespace, written.key));
  }

  /**
   * Checks the chunks can be joined (same stream signature and frame rate)
   * and returns their files in order.
   */
  async resolveForJoin(
    namespace: string,
    keys: string[],
    container: ChunkContainer,
  ): Promise<{ files: string[]; frames: number; chunkFrames: number[]; fps: number }> {
    let signature: string | null = null;
    let frames = 0;
    let fps = 0;
    const files: string[] = [];
    const chunkFrames: number[] = [];
    for (const key of keys) {
      const meta = await this.readMeta(namespace, key);
      const file = this.chunkPath(namespace, key, container);
      if (!meta || meta.container !== container || !(await exists(file))) {
        throw new ChunkCacheError(`Chunk ${key} is missing from the cache`);
      }
      if (signature !== null && (meta.streamSignature !== signature || meta.fps !== fps)) {
        throw new ChunkCacheError('Cached chunks came from different encoder settings');
      }
      signature = meta.streamSignature;
      fps = meta.fps;
      frames += meta.frames;
      files.push(file);
      chunkFrames.push(meta.frames);
    }
    return { files, frames, chunkFrames, fps };
  }

  /** Deletes least-recently-used chunks until the cache fits its size cap. */
  async evict(protectedKeys: ReadonlySet<string> = new Set()): Promise<void> {
    let namespaces: string[];
    try {
      namespaces = await fs.readdir(this.root);
    } catch {
      return;
    }
    const entries: Array<{ dir: string; key: string; bytes: number; mtimeMs: number }> = [];
    let total = 0;
    for (const namespace of namespaces) {
      const dir = this.namespaceDir(namespace);
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (name.startsWith('.tmp-')) {
          // A scratch dir left by a crash: remove once it is clearly stale.
          const stat = await fs.stat(path.join(dir, name)).catch(() => null);
          if (stat && Date.now() - stat.mtimeMs > 24 * 3600 * 1000) {
            await fs.rm(path.join(dir, name), { recursive: true, force: true });
          }
          continue;
        }
        const ext = path.extname(name);
        if (ext === '.json' || ext === '.tmp') {
          continue;
        }
        const stat = await fs.stat(path.join(dir, name)).catch(() => null);
        if (!stat) {
          continue;
        }
        total += stat.size;
        entries.push({
          dir,
          key: path.basename(name, ext),
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
    if (total <= this.maxBytes) {
      return;
    }
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of entries) {
      if (total <= this.maxBytes) {
        break;
      }
      if (protectedKeys.has(entry.key)) {
        continue;
      }
      for (const container of ['mp4', 'mov', 'webm'] as const) {
        await fs.rm(path.join(entry.dir, `${entry.key}.${container}`), { force: true });
      }
      await fs.rm(path.join(entry.dir, `${entry.key}.json`), { force: true });
      total -= entry.bytes;
    }
  }
}

/** Arguments for joining chunk files without re-encoding. */
export function buildConcatArgs(listPath: string, outputPath: string): string[] {
  return [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-map',
    '0:v:0',
    '-c',
    'copy',
    outputPath,
  ];
}

/**
 * The concat demuxer's input list. Every chunk gets its exact length: left to
 * itself the demuxer takes a chunk's length from its container, which leaves
 * out the last frame, so every later chunk would start a frame early.
 */
export function buildConcatList(entries: Array<{ file: string; durationSeconds: number }>): string {
  // Forward slashes work on every platform; single quotes are escaped the
  // way the concat demuxer's tokenizer expects.
  return entries
    .map(({ file, durationSeconds }) => {
      const quoted = file.replace(/\\/g, '/').replace(/'/g, "'\\''");
      return `file '${quoted}'\nduration ${durationSeconds.toFixed(6)}\n`;
    })
    .join('');
}

/** Frame times (seconds) from `ffmpeg -f framemd5` output. */
export function parseFrameTimes(framemd5: string): number[] {
  let timeBase = 0;
  const times: number[] = [];
  for (const line of framemd5.split('\n')) {
    const tb = line.match(/^#tb 0: (\d+)\/(\d+)/);
    if (tb) {
      timeBase = Number(tb[1]) / Number(tb[2]);
      continue;
    }
    if (!line || line.startsWith('#')) {
      continue;
    }
    const fields = line.split(',').map((f) => f.trim());
    if (fields[0] === '0' && fields.length >= 6) {
      times.push(Number(fields[2]) * timeBase);
    }
  }
  return times.sort((a, b) => a - b);
}

/**
 * Checks a joined video has every frame at its exact time: frame i within
 * half a frame of i / fps. Returns the reason when it does not.
 */
export function checkFrameTimes(
  times: number[],
  expectedFrames: number,
  fps: number,
): string | null {
  if (times.length !== expectedFrames) {
    return `has ${times.length} of ${expectedFrames} frames`;
  }
  const tolerance = 0.5 / fps;
  for (let i = 0; i < times.length; i += 1) {
    if (Math.abs(times[i] - times[0] - i / fps) > tolerance) {
      return `frame ${i} is at ${times[i].toFixed(4)} s instead of ${(i / fps).toFixed(4)} s`;
    }
  }
  return null;
}
