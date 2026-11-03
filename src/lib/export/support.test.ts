import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVideoEncoderConfig,
  buildVideoEncoderConfigCandidates,
  clearExportSupportCachesForTests,
  estimateEncodedVideoBytes,
  resolveSupportedExportTarget,
  resolveSupportedVideoEncoderConfig,
} from './support';

describe('estimateEncodedVideoBytes', () => {
  it('uses the configured export bitrate ladder', () => {
    // high 4k = 80 Mbps → (80_000_000 / 8) * 60 = 600_000_000
    expect(estimateEncodedVideoBytes('high', '4k', 60)).toBe(600_000_000);
    // balanced 1080p = 20 Mbps → (20_000_000 / 8) * 10 = 25_000_000
    expect(estimateEncodedVideoBytes('balanced', '1080p', 10)).toBe(25_000_000);
  });
});

describe('buildVideoEncoderConfig', () => {
  it('uses quality constant bitrate as the primary H.264 config', () => {
    expect(
      buildVideoEncoderConfig({
        format: 'mp4',
        quality: 'fast',
        resolution: '1080p',
        width: 1920,
        height: 1080,
        fps: 60,
      }),
    ).toMatchObject({
      latencyMode: 'quality',
      bitrateMode: 'constant',
    });
  });

  it('uses quality constant bitrate for balanced H.264 exports', () => {
    expect(
      buildVideoEncoderConfig({
        format: 'mp4',
        quality: 'balanced',
        resolution: '1080p',
        width: 1920,
        height: 1080,
        fps: 60,
      }),
    ).toMatchObject({
      latencyMode: 'quality',
      bitrateMode: 'constant',
    });
  });

  it('uses quality constant bitrate for high-quality H.264 exports', () => {
    expect(
      buildVideoEncoderConfig({
        format: 'mp4',
        quality: 'high',
        resolution: '1080p',
        width: 1920,
        height: 1080,
        fps: 60,
      }),
    ).toMatchObject({
      latencyMode: 'quality',
      bitrateMode: 'constant',
    });
  });

  it('orders H.264 fallback configs quality-first, hardware before software', () => {
    const candidates = buildVideoEncoderConfigCandidates({
      format: 'mp4',
      quality: 'high',
      resolution: '1080p',
      width: 1920,
      height: 1080,
      fps: 60,
    });

    expect(
      candidates.map((config) => ({
        latencyMode: config.latencyMode,
        bitrateMode: config.bitrateMode,
        hardwareAcceleration: config.hardwareAcceleration,
      })),
    ).toEqual([
      { latencyMode: 'quality', bitrateMode: 'constant', hardwareAcceleration: 'prefer-hardware' },
      { latencyMode: 'realtime', bitrateMode: 'constant', hardwareAcceleration: 'prefer-hardware' },
      { latencyMode: 'realtime', bitrateMode: 'variable', hardwareAcceleration: 'prefer-hardware' },
      { latencyMode: 'quality', bitrateMode: 'variable', hardwareAcceleration: 'prefer-hardware' },
      { latencyMode: 'quality', bitrateMode: 'constant', hardwareAcceleration: 'prefer-software' },
      { latencyMode: 'realtime', bitrateMode: 'constant', hardwareAcceleration: 'prefer-software' },
      { latencyMode: 'realtime', bitrateMode: 'variable', hardwareAcceleration: 'prefer-software' },
      { latencyMode: 'quality', bitrateMode: 'variable', hardwareAcceleration: 'prefer-software' },
    ]);
  });

  it('falls back to software H.264 when no hardware config is supported (Linux)', async () => {
    Object.defineProperty(globalThis, 'VideoEncoder', {
      configurable: true,
      writable: true,
      value: {
        isConfigSupported: vi.fn(async (config: { hardwareAcceleration?: string }) => ({
          supported: config.hardwareAcceleration === 'prefer-software',
          config,
        })),
      },
    });

    try {
      const resolved = await resolveSupportedVideoEncoderConfig({
        format: 'mp4',
        quality: 'high',
        resolution: '1080p',
        width: 1920,
        height: 1080,
        fps: 61,
      });

      expect(resolved).not.toBeNull();
      expect(resolved?.config.hardwareAcceleration).toBe('prefer-software');
    } finally {
      clearExportSupportCachesForTests();
      Reflect.deleteProperty(globalThis, 'VideoEncoder');
    }
  });
});

describe('resolveSupportedExportTarget', () => {
  const originalVideoEncoder = globalThis.VideoEncoder;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'VideoEncoder', {
      configurable: true,
      writable: true,
      value: {
        isConfigSupported: vi.fn(),
      },
    });
  });

  afterEach(() => {
    clearExportSupportCachesForTests();
    if (originalVideoEncoder) {
      Object.defineProperty(globalThis, 'VideoEncoder', {
        configurable: true,
        writable: true,
        value: originalVideoEncoder,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'VideoEncoder');
    }
  });

  it('returns the requested dimensions when the encoder supports them directly', async () => {
    const isConfigSupported = vi.mocked(VideoEncoder.isConfigSupported);
    isConfigSupported.mockImplementation(async (config) => ({
      supported: true,
      config,
    }));

    const result = await resolveSupportedExportTarget({
      format: 'mp4',
      quality: 'balanced',
      resolution: '1080p',
      width: 1920,
      height: 1080,
      fps: 60,
    });

    expect(result).toMatchObject({
      width: 1920,
      height: 1080,
      capped: false,
    });
    expect(isConfigSupported).toHaveBeenCalledTimes(1);
  });

  it('falls back to realtime VBR after quality candidates fail', async () => {
    const isConfigSupported = vi.mocked(VideoEncoder.isConfigSupported);
    isConfigSupported.mockImplementation(async (config) => ({
      supported: config.latencyMode === 'realtime' && config.bitrateMode === 'variable',
      config,
    }));

    const result = await resolveSupportedExportTarget({
      format: 'mp4',
      quality: 'high',
      resolution: '1080p',
      width: 1920,
      height: 1080,
      fps: 59,
    });

    expect(result).toMatchObject({
      width: 1920,
      height: 1080,
      capped: false,
      config: {
        latencyMode: 'realtime',
        bitrateMode: 'variable',
      },
    });
    // quality+CBR (1) and realtime+CBR (2) fail, realtime+VBR (3) succeeds
    expect(isConfigSupported).toHaveBeenCalledTimes(3);
  });

  it('caps dimensions down to the largest supported target when needed', async () => {
    const isConfigSupported = vi.mocked(VideoEncoder.isConfigSupported);
    isConfigSupported.mockImplementation(async (config) => ({
      supported: config.width <= 1600 && config.height <= 900,
      config,
    }));

    const result = await resolveSupportedExportTarget({
      format: 'mp4',
      quality: 'high',
      resolution: '4k',
      width: 1920,
      height: 1080,
      fps: 60,
    });

    expect(result).toMatchObject({
      width: 1600,
      height: 900,
      capped: true,
    });
    expect(isConfigSupported).toHaveBeenCalled();
  });

  it('returns null when no supported export target is found', async () => {
    const isConfigSupported = vi.mocked(VideoEncoder.isConfigSupported);
    isConfigSupported.mockResolvedValue({
      supported: false,
      config: null,
    });

    const result = await resolveSupportedExportTarget({
      format: 'gif',
      quality: 'fast',
      resolution: '720p',
      width: 1280,
      height: 720,
      fps: 30,
    });

    expect(result).toBeNull();
  });
});
