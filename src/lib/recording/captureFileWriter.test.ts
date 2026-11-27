import { describe, expect, it, vi } from 'vitest';
import { createCaptureFileWriter, type CaptureFileApi } from './captureFileWriter';

const blob = (text: string) => new Blob([text]);
const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

type FakeApi = { [K in keyof CaptureFileApi]: ReturnType<typeof vi.fn> & CaptureFileApi[K] };

function fakeApi(overrides: Partial<FakeApi> = {}) {
  const written: string[] = [];
  const api = {
    openCaptureStream: vi.fn(async () => 'stream-1'),
    appendCaptureStream: vi.fn(async (_id: string, chunk: ArrayBuffer) => {
      written.push(decode(chunk));
    }),
    closeCaptureStream: vi.fn(async () => '/tmp/capture.webm'),
    abortCaptureStream: vi.fn(async () => undefined),
    ...overrides,
  } as FakeApi;
  return { api, written };
}

describe('createCaptureFileWriter', () => {
  it('sends each chunk to disk in order and closes once they are all written', async () => {
    const { api, written } = fakeApi();
    const writer = createCaptureFileWriter(api, 'camera');

    writer.push(blob('a'));
    writer.push(blob('b'));
    writer.push(blob('c'));

    await expect(writer.close()).resolves.toBe('/tmp/capture.webm');
    expect(api.openCaptureStream).toHaveBeenCalledWith('camera');
    expect(written).toEqual(['a', 'b', 'c']);
    expect(api.closeCaptureStream).toHaveBeenCalledWith('stream-1');
    expect(api.closeCaptureStream.mock.invocationCallOrder[0]).toBeGreaterThan(
      api.appendCaptureStream.mock.invocationCallOrder[2],
    );
  });

  it('skips empty chunks', async () => {
    const { api } = fakeApi();
    const writer = createCaptureFileWriter(api, 'audio');

    writer.push(new Blob([]));
    await writer.close();

    expect(api.appendCaptureStream).not.toHaveBeenCalled();
  });

  it('fails the capture, and deletes what was written, when a write fails', async () => {
    const { api } = fakeApi({
      appendCaptureStream: vi
        .fn()
        .mockRejectedValueOnce(new Error('disk full')) as FakeApi['appendCaptureStream'],
    });
    const writer = createCaptureFileWriter(api, 'audio');

    writer.push(blob('a'));
    writer.push(blob('b'));

    await expect(writer.close()).rejects.toThrow('disk full');
    // A file with a gap in it would not play: nothing after the failure is sent.
    expect(api.appendCaptureStream).toHaveBeenCalledTimes(1);
    expect(api.abortCaptureStream).toHaveBeenCalledWith('stream-1');
    expect(api.closeCaptureStream).not.toHaveBeenCalled();
  });

  it('fails the capture when the file could not be opened', async () => {
    const { api } = fakeApi({
      openCaptureStream: vi
        .fn()
        .mockRejectedValue(new Error('no temp dir')) as FakeApi['openCaptureStream'],
    });
    const writer = createCaptureFileWriter(api, 'screen');

    writer.push(blob('a'));

    await expect(writer.close()).rejects.toThrow('no temp dir');
    expect(api.appendCaptureStream).not.toHaveBeenCalled();
  });

  it('deletes the file on abort, after pending writes', async () => {
    const { api } = fakeApi();
    const writer = createCaptureFileWriter(api, 'camera');

    writer.push(blob('a'));
    await writer.abort();

    expect(api.abortCaptureStream).toHaveBeenCalledWith('stream-1');
    expect(api.closeCaptureStream).not.toHaveBeenCalled();
  });

  it('abort never throws, even when the file never opened', async () => {
    const { api } = fakeApi({
      openCaptureStream: vi
        .fn()
        .mockRejectedValue(new Error('no temp dir')) as FakeApi['openCaptureStream'],
    });
    const writer = createCaptureFileWriter(api, 'camera');

    await expect(writer.abort()).resolves.toBeUndefined();
    expect(api.abortCaptureStream).not.toHaveBeenCalled();
  });
});
