/**
 * Uploads a file's parts to signed multipart URLs (S3/R2 UploadPart), a few
 * at a time, retrying each part on its own. Pure: the file comes in as a
 * ByteSource and the network as `fetch`, so it runs in tests with neither.
 */

/** Random-access reads of the file being uploaded. */
export interface ByteSource {
  /** Up to `length` bytes starting at `position`. */
  read(position: number, length: number): Promise<Uint8Array>;
}

export interface PartTarget {
  partNumber: number;
  url: string;
}

export interface UploadedPart {
  partNumber: number;
  /** Exactly as the storage returned it, quotes included. */
  etag: string;
}

export class PartUploadError extends Error {
  constructor(
    readonly partNumber: number,
    /** HTTP status from the storage; 0 when it couldn't be reached. */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PartUploadError';
  }
}

export interface UploadPartsOptions {
  source: ByteSource;
  sizeBytes: number;
  partSize: number;
  parts: PartTarget[];
  fetch: typeof globalThis.fetch;
  /** Parts in flight at once. */
  concurrency?: number;
  /** Extra attempts per part after the first, for network errors and 5xx/429. */
  retries?: number;
  /** Bytes read from disk per step; also how often progress moves. */
  chunkSize?: number;
  signal?: AbortSignal;
  /** Bytes sent so far in this call (falls back when a part is retried). */
  onProgress?: (uploadedBytes: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRIES = 4;
const DEFAULT_CHUNK_SIZE = 256 * 1024;

export const backoffMs = (attempt: number): number => Math.min(500 * 2 ** (attempt - 1), 8000);

/** The byte range [start, end) of a 1-based part. */
export function partRange(
  partNumber: number,
  partSize: number,
  sizeBytes: number,
): { start: number; end: number } {
  const start = (partNumber - 1) * partSize;
  return { start, end: Math.min(start + partSize, sizeBytes) };
}

const abortError = () => new DOMException('The upload was cancelled.', 'AbortError');

const isRetryable = (err: PartUploadError) =>
  err.status === 0 || err.status === 429 || err.status >= 500;

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export async function uploadParts(options: UploadPartsOptions): Promise<UploadedPart[]> {
  const {
    source,
    sizeBytes,
    partSize,
    fetch,
    concurrency = DEFAULT_CONCURRENCY,
    retries = DEFAULT_RETRIES,
    chunkSize = DEFAULT_CHUNK_SIZE,
    onProgress,
  } = options;

  // One controller for every part: the caller's cancel, or a part that failed for good.
  const controller = new AbortController();
  const outer = options.signal;
  const onOuterAbort = () => controller.abort();
  if (outer?.aborted) {
    throw abortError();
  }
  outer?.addEventListener('abort', onOuterAbort, { once: true });
  const signal = controller.signal;
  const sleep = options.sleep ?? ((ms: number) => defaultSleep(ms, signal));

  let uploaded = 0;
  const count = (delta: number) => {
    uploaded += delta;
    onProgress?.(uploaded);
  };

  const sendOnce = async (target: PartTarget): Promise<string> => {
    const { start, end } = partRange(target.partNumber, partSize, sizeBytes);
    let position = start;
    let counted = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        if (position >= end) {
          stream.close();
          return;
        }
        const chunk = await source.read(position, Math.min(chunkSize, end - position));
        if (chunk.length === 0) {
          stream.error(new Error('The file got shorter while it was uploading.'));
          return;
        }
        position += chunk.length;
        counted += chunk.length;
        stream.enqueue(chunk);
        count(chunk.length);
      },
    });

    let response: Response;
    try {
      response = await fetch(target.url, {
        method: 'PUT',
        body,
        headers: { 'content-length': String(end - start) },
        signal,
        // Node's fetch needs this to send a streamed body.
        duplex: 'half',
      } as RequestInit);
    } catch (err) {
      count(-counted);
      if (signal.aborted) {
        throw abortError();
      }
      throw new PartUploadError(
        target.partNumber,
        0,
        err instanceof Error ? err.message : 'Could not reach the storage.',
      );
    }
    // Drain the (usually empty) body so the connection can be reused.
    await response.arrayBuffer().catch(() => undefined);
    if (!response.ok) {
      count(-counted);
      throw new PartUploadError(
        target.partNumber,
        response.status,
        `The storage answered ${response.status} for part ${target.partNumber}.`,
      );
    }
    const etag = response.headers.get('etag');
    if (!etag) {
      count(-counted);
      throw new PartUploadError(
        target.partNumber,
        response.status,
        `The storage returned no ETag for part ${target.partNumber}.`,
      );
    }
    return etag;
  };

  const sendWithRetries = async (target: PartTarget): Promise<UploadedPart> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return { partNumber: target.partNumber, etag: await sendOnce(target) };
      } catch (err) {
        if (signal.aborted || !(err instanceof PartUploadError)) {
          throw signal.aborted ? abortError() : err;
        }
        if (!isRetryable(err) || attempt >= retries) {
          throw err;
        }
        await sleep(backoffMs(attempt + 1));
        if (signal.aborted) {
          throw abortError();
        }
      }
    }
  };

  const queue = [...options.parts].sort((a, b) => a.partNumber - b.partNumber);
  const results: UploadedPart[] = [];
  let failure: unknown = null;

  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next || signal.aborted) {
        return;
      }
      try {
        results.push(await sendWithRetries(next));
      } catch (err) {
        if (failure === null) {
          failure = err;
          controller.abort();
        }
        return;
      }
    }
  };

  try {
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, () =>
      worker(),
    );
    await Promise.all(workers);
  } finally {
    outer?.removeEventListener('abort', onOuterAbort);
  }

  if (outer?.aborted) {
    throw abortError();
  }
  if (failure !== null) {
    throw failure;
  }
  return results.sort((a, b) => a.partNumber - b.partNumber);
}
