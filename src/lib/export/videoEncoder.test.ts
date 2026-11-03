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
