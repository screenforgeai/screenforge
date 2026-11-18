import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoEncoderWrapper } from './videoEncoder';

class FakeEncodedVideoChunk {
  public readonly byteLength = 1;
  public readonly duration = 16_667;

  constructor(
    public readonly timestamp: number,
    public readonly type: EncodedVideoChunkType,
  ) {}

  copyTo(destination: ArrayBuffer): void {
    new Uint8Array(destination)[0] = 1;
  }
}

class FakeVideoFrame {
  public readonly timestamp: number;

  constructor(_canvas: HTMLCanvasElement, init: VideoFrameInit) {
    this.timestamp = init.timestamp;
  }

  close(): void {
    // no-op
  }
}

class FakeVideoEncoder {
  private readonly output: EncodedVideoChunkOutputCallback;

  static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
    return {
      supported: true,
      config: {
        ...config,
        decoderConfig: {
          codec: config.codec,
          codedWidth: config.width,
          codedHeight: config.height,
        },
      },
    };
  }

  constructor(init: VideoEncoderInit) {
    this.output = init.output;
  }

  configure(): void {
    // no-op
  }

  encode(frame: FakeVideoFrame, options?: VideoEncoderEncodeOptions): void {
    this.output(
      new FakeEncodedVideoChunk(
        frame.timestamp,
        options?.keyFrame ? 'key' : 'delta',
      ) as unknown as EncodedVideoChunk,
    );
  }

  async flush(): Promise<void> {
    // no-op
  }

  close(): void {
    // no-op
  }
}

/**
 * Like the software H.264 encoders: no stream configuration up front, only
 * with the first keyframe's output, and outputs arrive asynchronously.
 */
class LateConfigVideoEncoder {
  private readonly output: EncodedVideoChunkOutputCallback;
  private queue: Promise<void> = Promise.resolve();

  static async isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport> {
    return { supported: true, config };
  }

  constructor(init: VideoEncoderInit) {
    this.output = init.output;
  }

  configure(): void {
    // no-op
  }

  encode(frame: FakeVideoFrame, options?: VideoEncoderEncodeOptions): void {
    const key = options?.keyFrame === true;
    this.queue = this.queue.then(() =>
      this.output(
        new FakeEncodedVideoChunk(
          frame.timestamp,
          key ? 'key' : 'delta',
        ) as unknown as EncodedVideoChunk,
        key ? { decoderConfig: { codec: 'avc1.640034', codedWidth: 1280, codedHeight: 720 } } : {},
      ),
    );
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  close(): void {
    // no-op
  }
}

describe('VideoEncoderWrapper with the stream configuration on the first keyframe', () => {
  beforeEach(() => {
    vi.stubGlobal('VideoEncoder', LateConfigVideoEncoder);
    vi.stubGlobal('VideoFrame', FakeVideoFrame);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes the first keyframe before the frames encoded while the muxer was being set up', async () => {
    const frameMicros = (frame: number) => Math.round((frame / 30) * 1_000_000);
    let releaseMuxer!: () => void;
    const muxerSetUp = new Promise<void>((resolve) => {
      releaseMuxer = resolve;
    });
    const written: Array<{ timestamp: number; type: string }> = [];

    const { wrapper, decoderConfig } = await VideoEncoderWrapper.create({
      format: 'mp4',
      quality: 'balanced',
      resolution: '720p',
      width: 1280,
      height: 720,
      fps: 30,
      onChunkBatch: async (chunks) => {
        written.push(...chunks.map(({ timestamp, type }) => ({ timestamp, type })));
      },
      // A slow machine: setting up the muxer takes longer than the batch timer.
      onDecoderConfig: () => muxerSetUp,
      onError: () => undefined,
    });
    expect(decoderConfig).toBeNull();

    for (let frame = 0; frame < 70; frame += 1) {
      wrapper.encodeFrame(document.createElement('canvas'), frameMicros(frame), frame % 30 === 0);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    // Nothing goes out before the keyframe that sets up the muxer.
    expect(written).toEqual([]);

    releaseMuxer();
    await wrapper.flush();
    expect(written.map((c) => c.timestamp)).toEqual(
      Array.from({ length: 70 }, (_, i) => frameMicros(i)),
    );
    expect(written[0].type).toBe('key');
  });
});

describe('VideoEncoderWrapper', () => {
  beforeEach(() => {
    vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
    vi.stubGlobal('VideoFrame', FakeVideoFrame);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('waits for the final encoded chunk batch before flush resolves', async () => {
    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    let batchStarted = false;
    let batchFinished = false;

    const { wrapper } = await VideoEncoderWrapper.create({
      format: 'mp4',
      quality: 'balanced',
      resolution: '1080p',
      width: 1920,
      height: 1080,
      fps: 60,
      onChunkBatch: async () => {
        batchStarted = true;
        await batchGate;
        batchFinished = true;
      },
      onDecoderConfig: async () => undefined,
      onError: vi.fn(),
    });
    wrapper.markMuxerReady();

    const canvas = document.createElement('canvas');
    wrapper.encodeFrame(canvas, 0, true);

    let flushResolved = false;
    const flushPromise = wrapper.flush().then(() => {
      flushResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(batchStarted).toBe(true);
    expect(flushResolved).toBe(false);

    releaseBatch();
    await flushPromise;

    expect(batchFinished).toBe(true);
    expect(flushResolved).toBe(true);
  });

  it('can apply backpressure while encoded chunk batches are still writing', async () => {
    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((resolve) => {
      releaseBatch = resolve;
    });
    let batchStarted = false;
    let batchFinished = false;

    const { wrapper } = await VideoEncoderWrapper.create({
      format: 'mp4',
      quality: 'balanced',
      resolution: '1080p',
      width: 1920,
      height: 1080,
      fps: 60,
      onChunkBatch: async () => {
        batchStarted = true;
        await batchGate;
        batchFinished = true;
      },
      onDecoderConfig: async () => undefined,
      onError: vi.fn(),
    });
    wrapper.markMuxerReady();

    const canvas = document.createElement('canvas');
    for (let index = 0; index < 60; index += 1) {
      wrapper.encodeFrame(canvas, index * 16_667, index === 0);
    }

    let waitResolved = false;
    const waitPromise = wrapper.waitForPendingWrites(1).then(() => {
      waitResolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(batchStarted).toBe(true);
    expect(waitResolved).toBe(false);

    releaseBatch();
    await waitPromise;

    expect(batchFinished).toBe(true);
    expect(waitResolved).toBe(true);
  });
});
