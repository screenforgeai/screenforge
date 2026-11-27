export type CaptureStreamKind = 'audio' | 'camera' | 'screen';

export type CaptureFileApi = {
  openCaptureStream: (kind: CaptureStreamKind) => Promise<string>;
  appendCaptureStream: (id: string, chunk: ArrayBuffer) => Promise<void>;
  closeCaptureStream: (id: string) => Promise<string>;
  abortCaptureStream: (id: string) => Promise<void>;
};

export type CaptureFileWriter = {
  /** Queues a MediaRecorder chunk to be appended to the file. */
  push: (chunk: Blob) => void;
  /** Waits for every queued chunk, closes the file and resolves to its path. */
  close: () => Promise<string>;
  /** Waits for queued chunks, then deletes the file. Never throws. */
  abort: () => Promise<void>;
};

/**
 * Streams a MediaRecorder's chunks to a temp file in the main process as they
 * arrive, so a long recording is never held in memory and stopping it only
 * flushes the last second. If a write fails, the rest are dropped and close()
 * rejects: a file with a gap in it would not play.
 */
export function createCaptureFileWriter(
  api: CaptureFileApi,
  kind: CaptureStreamKind,
): CaptureFileWriter {
  let failure: unknown = null;
  const opened = api.openCaptureStream(kind);
  let queue: Promise<void> = opened.then(
    () => undefined,
    (err) => {
      failure ??= err;
    },
  );

  return {
    push(chunk) {
      if (chunk.size === 0) {
        return;
      }
      queue = queue
        .then(async () => {
          if (failure) {
            return;
          }
          const id = await opened;
          await api.appendCaptureStream(id, await chunk.arrayBuffer());
        })
        .catch((err) => {
          failure ??= err;
        });
    },

    async close() {
      await queue;
      const id = await opened;
      if (failure) {
        await api.abortCaptureStream(id).catch(() => undefined);
        throw failure;
      }
      return api.closeCaptureStream(id);
    },

    async abort() {
      await queue;
      try {
        await api.abortCaptureStream(await opened);
      } catch {
        // Nothing was opened, or it is already gone.
      }
    },
  };
}
