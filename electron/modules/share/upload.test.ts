// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { partRange, PartUploadError, uploadParts, type ByteSource } from './upload';

const MiB = 1024 * 1024;

/** A file held in memory; records every read so tests can check nothing reads it whole. */
const memorySource = (bytes: Uint8Array) => {
  const reads: Array<{ position: number; length: number }> = [];
  const source: ByteSource = {
    async read(position, length) {
      reads.push({ position, length });
      return bytes.subarray(position, Math.min(position + length, bytes.length));
    },
  };
  return { source, reads };
};

const fileOf = (size: number) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    bytes[i] = i % 251;
  }
  return bytes;
};

/** Collects a fetch body (a ReadableStream of chunks) into one array. */
const drain = async (body: unknown): Promise<Uint8Array> => {
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

const okWithEtag = (etag: string) => new Response(null, { status: 200, headers: { ETag: etag } });

const parts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    partNumber: i + 1,
    url: `https://r2.test/part-${i + 1}`,
  }));

describe('partRange', () => {
  it('gives each part its byte range, the last one shorter', () => {
    expect(partRange(1, 16 * MiB, 40 * MiB)).toEqual({ start: 0, end: 16 * MiB });
    expect(partRange(3, 16 * MiB, 40 * MiB)).toEqual({ start: 32 * MiB, end: 40 * MiB });
  });
});

describe('uploadParts', () => {
  it('PUTs each part’s exact bytes with its length and returns etags in order', async () => {
    const bytes = fileOf(25);
    const { source } = memorySource(bytes);
    const received = new Map<string, Uint8Array>();
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('PUT');
      received.set(String(url), await drain(init?.body));
      const n = String(url).split('-').pop();
      return okWithEtag(`"etag-${n}"`);
    });

    const result = await uploadParts({
      source,
      sizeBytes: 25,
      partSize: 10,
      parts: parts(3).reverse(),
      fetch,
      chunkSize: 4,
    });

    expect(result).toEqual([
      { partNumber: 1, etag: '"etag-1"' },
      { partNumber: 2, etag: '"etag-2"' },
      { partNumber: 3, etag: '"etag-3"' },
    ]);
    expect(Array.from(received.get('https://r2.test/part-1') ?? [])).toEqual(
      Array.from(bytes.subarray(0, 10)),
    );
    expect(Array.from(received.get('https://r2.test/part-3') ?? [])).toEqual(
      Array.from(bytes.subarray(20, 25)),
    );
    const lengths = fetch.mock.calls.map(
      ([, init]) => (init?.headers as Record<string, string>)['content-length'],
    );
    expect(lengths.sort()).toEqual(['10', '10', '5']);
  });

  it('reads the file a chunk at a time, never a whole part at once', async () => {
    const { source, reads } = memorySource(fileOf(20));
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      await drain(init?.body);
      return okWithEtag('"e"');
    });
    await uploadParts({
      source,
      sizeBytes: 20,
      partSize: 20,
      parts: parts(1),
      fetch,
      chunkSize: 8,
    });
    expect(reads).toEqual([
      { position: 0, length: 8 },
      { position: 8, length: 8 },
      { position: 16, length: 4 },
    ]);
  });

  it('never runs more than the concurrency limit at once', async () => {
    const { source } = memorySource(fileOf(60));
    let running = 0;
    let peak = 0;
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      running++;
      peak = Math.max(peak, running);
      await drain(init?.body);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return okWithEtag('"e"');
    });
    await uploadParts({
      source,
      sizeBytes: 60,
      partSize: 10,
      parts: parts(6),
      fetch,
      concurrency: 3,
    });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(peak).toBe(3);
  });

  it('reports progress in bytes as the body is sent', async () => {
    const { source } = memorySource(fileOf(20));
    const progress: number[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      await drain(init?.body);
      return okWithEtag('"e"');
    });
    await uploadParts({
      source,
      sizeBytes: 20,
      partSize: 10,
      parts: parts(2),
      fetch,
      concurrency: 1,
      chunkSize: 5,
      onProgress: (bytes) => progress.push(bytes),
    });
    expect(progress).toEqual([5, 10, 15, 20]);
  });

  it('retries a failed part with backoff, taking back the bytes it had counted', async () => {
    const { source } = memorySource(fileOf(10));
    const progress: number[] = [];
    const sleep = vi.fn(async () => undefined);
    const fetch = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        await drain(init?.body);
        throw new TypeError('fetch failed');
      })
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        await drain(init?.body);
        return new Response('slow down', { status: 503 });
      })
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        await drain(init?.body);
        return okWithEtag('"third-time"');
      });

    const result = await uploadParts({
      source,
      sizeBytes: 10,
      partSize: 10,
      parts: parts(1),
      fetch,
      sleep,
      chunkSize: 10,
      onProgress: (bytes) => progress.push(bytes),
    });

    expect(result).toEqual([{ partNumber: 1, etag: '"third-time"' }]);
    expect(sleep).toHaveBeenCalledTimes(2);
    const [first, second] = sleep.mock.calls.map(([ms]) => ms as number);
    expect(second).toBeGreaterThan(first);
    expect(progress).toEqual([10, 0, 10, 0, 10]);
  });

  it('gives up after the retries, saying which part failed and that it was the network', async () => {
    const { source } = memorySource(fileOf(10));
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const error = await uploadParts({
      source,
      sizeBytes: 10,
      partSize: 10,
      parts: parts(1),
      fetch,
      retries: 2,
      sleep: async () => undefined,
    }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(PartUploadError);
    expect(error).toMatchObject({ partNumber: 1, status: 0 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry a part the storage refused (an expired signature)', async () => {
    const { source } = memorySource(fileOf(10));
    const fetch = vi.fn(async () => new Response('expired', { status: 403 }));
    const error = await uploadParts({
      source,
      sizeBytes: 10,
      partSize: 10,
      parts: parts(1),
      fetch,
      sleep: async () => undefined,
    }).catch((err: unknown) => err);
    expect(error).toMatchObject({ name: 'PartUploadError', partNumber: 1, status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fails a part whose response has no ETag', async () => {
    const { source } = memorySource(fileOf(10));
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(
      uploadParts({
        source,
        sizeBytes: 10,
        partSize: 10,
        parts: parts(1),
        fetch,
        retries: 0,
      }),
    ).rejects.toBeInstanceOf(PartUploadError);
  });

  it('stops every part when aborted, and rejects with an AbortError', async () => {
    const { source } = memorySource(fileOf(30));
    const controller = new AbortController();
    const seenSignals: AbortSignal[] = [];
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal;
          seenSignals.push(signal);
          signal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    const promise = uploadParts({
      source,
      sizeBytes: 30,
      partSize: 10,
      parts: parts(3),
      fetch,
      signal: controller.signal,
      sleep: async () => undefined,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(seenSignals.every((s) => s.aborted)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stops the other parts when one fails for good', async () => {
    const { source } = memorySource(fileOf(40));
    const signals: AbortSignal[] = [];
    const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      if (String(url).endsWith('part-1')) {
        return Promise.resolve(new Response('no', { status: 403 }));
      }
      return new Promise<Response>((_resolve, reject) => {
        (init?.signal as AbortSignal).addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    });
    await expect(
      uploadParts({ source, sizeBytes: 40, partSize: 10, parts: parts(4), fetch, concurrency: 2 }),
    ).rejects.toMatchObject({ name: 'PartUploadError', status: 403 });
    expect(signals.slice(1).every((s) => s.aborted)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
