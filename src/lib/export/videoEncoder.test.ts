import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decoderConfigsMatch, VideoEncoderWrapper } from './videoEncoder';

describe('decoderConfigsMatch', () => {
  const config = (bytes: number[], overrides: Record<string, unknown> = {}) => ({
    codec: 'avc1.640034',
    codedWidth: 1280,
    codedHeight: 720,
    description: new Uint8Array(bytes).buffer,
    ...overrides,
  });

  it('matches two encoders that give the same stream header', () => {
    expect(decoderConfigsMatch(config([1, 2, 3]), config([1, 2, 3]))).toBe(true);
  });

  it('tells apart a different SPS/PPS, codec or size', () => {
    expect(decoderConfigsMatch(config([1, 2, 3]), config([1, 2, 4]))).toBe(false);
    expect(decoderConfigsMatch(config([1, 2, 3]), config([1, 2]))).toBe(false);
    expect(decoderConfigsMatch(config([1]), config([1], { codec: 'avc1.4d0028' }))).toBe(false);
    expect(decoderConfigsMatch(config([1]), config([1], { codedHeight: 1080 }))).toBe(false);
  });

  it('treats a missing header as matching only another missing one', () => {
    expect(decoderConfigsMatch(null, null)).toBe(true);
    expect(decoderConfigsMatch(config([1]), null)).toBe(false);
    expect(decoderConfigsMatch(config([], { description: undefined }), config([1]))).toBe(false);
  });
});

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
  /** Clones not closed yet: frames the wrapper still holds. */
  static openClones = 0;
  public readonly timestamp: number;
  private closed = false;
  private isClone = false;

  constructor(_canvas: HTMLCanvasElement, init: VideoFrameInit) {
    this.timestamp = init.timestamp;
  }

  clone(): FakeVideoFrame {
    const copy = new FakeVideoFrame(undefined as unknown as HTMLCanvasElement, {
      timestamp: this.timestamp,
    });
    copy.isClone = true;
    FakeVideoFrame.openClones += 1;
    return copy;
  }

  close(): void {
    if (this.isClone && !this.closed) {
      FakeVideoFrame.openClones -= 1;
    }
    this.closed = true;
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

  reset(): void {
    // no-op
  }

  close(): void {
    // no-op
  }
}

/**
 * An encoder that outputs asynchronously, like a real one, and can get a
 * requested keyframe wrong: `misbehave(timestamp, attempt)` returns 'delta'
 * (encode it as a delta frame) or 'drop' (no output) for a keyframe request,
 * or null to behave. reset() discards outputs not delivered yet.
 */
class ScriptedVideoEncoder {
  static misbehave: (timestamp: number, attempt: number) => 'delta' | 'drop' | null = () => null;
  static instance: ScriptedVideoEncoder | null = null;
  static isConfigSupported = FakeVideoEncoder.isConfigSupported;

  public resets = 0;
  private generation = 0;
  private readonly attempts = new Map<number, number>();
  private queue: Promise<void> = Promise.resolve();
  private readonly output: EncodedVideoChunkOutputCallback;

  constructor(init: VideoEncoderInit) {
    this.output = init.output;
    ScriptedVideoEncoder.instance = this;
  }

  configure(): void {
    // no-op
  }

  encode(frame: FakeVideoFrame, options?: VideoEncoderEncodeOptions): void {
    const generation = this.generation;
    let type: 'key' | 'delta' | null = options?.keyFrame ? 'key' : 'delta';
    if (options?.keyFrame) {
      const attempt = (this.attempts.get(frame.timestamp) ?? 0) + 1;
      this.attempts.set(frame.timestamp, attempt);
      const fault = ScriptedVideoEncoder.misbehave(frame.timestamp, attempt);
      type = fault === 'drop' ? null : fault === 'delta' ? 'delta' : 'key';
    }
    const timestamp = frame.timestamp;
    this.queue = this.queue.then(() => {
      if (type !== null && generation === this.generation) {
        this.output(new FakeEncodedVideoChunk(timestamp, type) as unknown as EncodedVideoChunk, {});
      }
    });
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  reset(): void {
    this.resets += 1;
    this.generation += 1;
  }

  close(): void {
    // no-op
  }
}

describe('VideoEncoderWrapper keyframe recovery', () => {
  const frameMicros = (frame: number) => Math.round((frame / 30) * 1_000_000);

  beforeEach(() => {
    vi.stubGlobal('VideoEncoder', ScriptedVideoEncoder);
    vi.stubGlobal('VideoFrame', FakeVideoFrame);
    FakeVideoFrame.openClones = 0;
  });

  afterEach(() => {
    ScriptedVideoEncoder.misbehave = () => null;
    vi.unstubAllGlobals();
  });

  /** Encodes `count` frames with a keyframe every 30 and returns what reached the muxer. */
  async function encodeAll(count: number) {
    const written: Array<{ timestamp: number; type: string }> = [];
    const retries: Array<{ problem: string; attempt: number; timestampMicros: number }> = [];
    const errors: Error[] = [];
    const { wrapper } = await VideoEncoderWrapper.create({
      format: 'mp4',
      quality: 'balanced',
      resolution: '720p',
      width: 1280,
      height: 720,
      fps: 30,
      onChunkBatch: async (chunks) => {
        written.push(...chunks.map(({ timestamp, type }) => ({ timestamp, type })));
      },
      onDecoderConfig: async () => undefined,
      onError: (err) => errors.push(err),
      onKeyframeRetry: (retry) => retries.push(retry),
    });
    wrapper.markMuxerReady();
    // Stops at an encoder error, as the capture loop does.
    for (let frame = 0; frame < count && errors.length === 0; frame += 1) {
      wrapper.encodeFrame(document.createElement('canvas'), frameMicros(frame), frame % 30 === 0);
      await wrapper.waitForEncoderCapacity(6);
    }
    await wrapper.flush();
    return { written, retries, errors };
  }

  const expectComplete = (written: Array<{ timestamp: number; type: string }>, count: number) => {
    expect(written.map((c) => c.timestamp)).toEqual(
      Array.from({ length: count }, (_, i) => frameMicros(i)),
    );
    written.forEach((chunk, i) => expect(chunk.type).toBe(i % 30 === 0 ? 'key' : 'delta'));
    // Every frame held for a keyframe was let go once it came out.
    expect(FakeVideoFrame.openClones).toBe(0);
  };

  it('passes a well-behaved encoder through without retrying', async () => {
    const { written, retries, errors } = await encodeAll(65);
    expectComplete(written, 65);
    expect(retries).toEqual([]);
    expect(errors).toEqual([]);
    expect(ScriptedVideoEncoder.instance?.resets).toBe(0);
  });

  it('encodes again from a keyframe that came out as a delta frame', async () => {
    ScriptedVideoEncoder.misbehave = (timestamp, attempt) =>
      timestamp === frameMicros(30) && attempt === 1 ? 'delta' : null;
    const { written, retries, errors } = await encodeAll(65);
    expectComplete(written, 65);
    expect(retries).toEqual([{ timestampMicros: frameMicros(30), problem: 'delta', attempt: 1 }]);
    expect(errors).toEqual([]);
  });

  it('encodes again from a keyframe the encoder dropped, even the very first', async () => {
    ScriptedVideoEncoder.misbehave = (timestamp, attempt) =>
      timestamp === 0 && attempt === 1 ? 'drop' : null;
    const { written, retries, errors } = await encodeAll(40);
    expectComplete(written, 40);
    expect(retries).toEqual([{ timestampMicros: 0, problem: 'missing', attempt: 1 }]);
    expect(errors).toEqual([]);
  });

  it('fails the export when the keyframe never comes out', async () => {
    ScriptedVideoEncoder.misbehave = (timestamp) =>
      timestamp === frameMicros(30) ? 'delta' : null;
    const { written, retries, errors } = await encodeAll(40);
    expect(retries.map((r) => r.attempt)).toEqual([1, 2, 3, 4]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('did not produce a keyframe');
    // Nothing from the failed keyframe on reached the muxer, and nothing is held.
    expect(written.every((c) => c.timestamp < frameMicros(30))).toBe(true);
    expect(FakeVideoFrame.openClones).toBe(0);
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
