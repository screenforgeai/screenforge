import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import log from '../../lib/logger';

/**
 * Files the toolbar's MediaRecorders (mic, camera, Wayland screen) write to
 * while recording. Each one-second chunk is appended as it arrives, so a long
 * take is never held in memory and stopping only has to flush the last chunk.
 */
export type CaptureStreamKind = 'audio' | 'camera' | 'screen';

const FILE_PREFIX: Record<CaptureStreamKind, string> = {
  audio: 'screenforge-audio',
  camera: 'screenforge-camera',
  screen: 'screenforge',
};

type CaptureStream = {
  filePath: string;
  handle: FileHandle;
  bytes: number;
  /** Writes run one after another, in the order the chunks were sent. */
  queue: Promise<void>;
  error: unknown;
};

const streams = new Map<string, CaptureStream>();

function getStream(id: string): CaptureStream {
  const stream = streams.get(id);
  if (!stream) {
    throw new Error(`Capture stream ${id} is not open`);
  }
  return stream;
}

async function writeAll(handle: FileHandle, data: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < data.byteLength) {
    const { bytesWritten } = await handle.write(data, offset, data.byteLength - offset);
    offset += bytesWritten;
  }
}

export async function openCaptureStream(kind: CaptureStreamKind): Promise<string> {
  const filePath = path.join(app.getPath('temp'), `${FILE_PREFIX[kind]}-${randomUUID()}.webm`);
  const handle = await fs.open(filePath, 'w');
  const id = randomUUID();
  streams.set(id, { filePath, handle, bytes: 0, queue: Promise.resolve(), error: null });
  log.info('[capture-stream] opened', { kind, filePath });
  return id;
}

export function appendCaptureStream(id: string, chunk: ArrayBuffer | Uint8Array): Promise<void> {
  let stream: CaptureStream;
  try {
    stream = getStream(id);
  } catch (err) {
    return Promise.reject(err);
  }
  const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
  stream.queue = stream.queue.then(async () => {
    if (stream.error) {
      return;
    }
    try {
      await writeAll(stream.handle, data);
      stream.bytes += data.byteLength;
    } catch (err) {
      log.error('[capture-stream] write failed', { filePath: stream.filePath, err });
      stream.error = err;
    }
  });
  return stream.queue.then(() => {
    if (stream.error) {
      throw stream.error;
    }
  });
}

/** Waits for pending writes and closes the file. Resolves to its path. */
export async function closeCaptureStream(id: string): Promise<string> {
  const stream = getStream(id);
  streams.delete(id);
  await stream.queue;
  await stream.handle.close().catch((err) => {
    stream.error ??= err;
  });
  if (stream.error || stream.bytes === 0) {
    await fs.unlink(stream.filePath).catch(() => undefined);
    if (stream.error) {
      throw stream.error;
    }
    throw new Error('The capture stream did not receive any data.');
  }
  log.info('[capture-stream] closed', { filePath: stream.filePath, bytes: stream.bytes });
  return stream.filePath;
}

/** Closes and deletes the file. A stream that is already gone is fine. */
export async function abortCaptureStream(id: string): Promise<void> {
  const stream = streams.get(id);
  if (!stream) {
    return;
  }
  streams.delete(id);
  await stream.queue;
  await stream.handle.close().catch(() => undefined);
  await fs.unlink(stream.filePath).catch(() => undefined);
}
