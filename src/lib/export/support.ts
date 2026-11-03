import type { ExportFormat, ExportQuality, ExportResolution } from '../../types';

export interface ExportEncoderConfig {
  codec: string;
  width: number;
  height: number;
  bitrate: number;
  framerate: number;
  hardwareAcceleration?: 'prefer-software' | 'prefer-hardware' | 'no-preference';
  latencyMode?: 'quality' | 'realtime';
  bitrateMode?: 'constant' | 'variable' | 'quantizer';
  contentHint?: 'detail' | 'text' | 'motion';
}

export type ResolvedExportEncoderConfig = ExportEncoderConfig & {
  decoderConfig?: VideoDecoderConfig;
};

interface ExportEncoderSupportResult {
  supported: boolean;
  config?: ResolvedExportEncoderConfig;
}

export interface ResolvedVideoEncoderConfig {
  requestedConfig: ExportEncoderConfig;
  config: ResolvedExportEncoderConfig;
}

type VideoEncoderSupportProbe = {
  isConfigSupported?: (
    config: ExportEncoderConfig,
  ) => Promise<ExportEncoderSupportResult> | ExportEncoderSupportResult;
};

// Bitrates are tuned for screen-recording content, which is highly compressible.
// The previous values (up to 120 Mbps @ 1080p) caused VideoToolbox to produce
// ~1.9 MB per frame in VBR mode, generating enough thermal load to throttle the
// hardware encoder from 30 fps down to ~8 fps on Apple Silicon — turning a
// 1-minute export into a 20-minute one.
//
// These values still produce excellent perceptual quality for screen content:
//   fast     — equivalent to high-quality 1080p streaming (≈ 8 Mbps)
//   balanced — equivalent to Blu-ray (≈ 20 Mbps), effectively lossless for screens
//   high     — near-lossless (≈ 35 Mbps), indistinguishable from raw at 1080p
export const EXPORT_VIDEO_BITRATE_MAP: Record<ExportQuality, Record<ExportResolution, number>> = {
  fast: { '720p': 6_000_000, '1080p': 12_000_000, '4k': 30_000_000 },
  balanced: { '720p': 10_000_000, '1080p': 20_000_000, '4k': 50_000_000 },
  high: { '720p': 18_000_000, '1080p': 35_000_000, '4k': 80_000_000 },
};

const encoderSupportCache = new Map<string, ResolvedVideoEncoderConfig | null>();
const supportedTargetCache = new Map<string, SupportedExportTarget | null>();

function normalizeEvenDimension(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function scaleDimensions(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  return {
    width: normalizeEvenDimension(width * scale),
    height: normalizeEvenDimension(height * scale),
  };
}

function buildEncoderSupportCacheKey(options: ExportEncoderProbeOptions): string {
  return [
    options.format,
    options.quality,
    options.resolution,
    normalizeEvenDimension(options.width),
    normalizeEvenDimension(options.height),
    options.fps,
  ].join(':');
}

export function codecForFormat(format: ExportFormat): string {
  if (format === 'webm') {
    return 'vp09.00.10.08';
  }

  return 'avc1.640034';
}

export function bitrateFor(quality: ExportQuality, resolution: ExportResolution): number {
  return EXPORT_VIDEO_BITRATE_MAP[quality][resolution];
}

export function isRandomAccessMuxFormat(format: ExportFormat): boolean {
  return format === 'mp4' || format === 'mov' || format === 'gif';
}

export function estimateEncodedVideoBytes(
  quality: ExportQuality,
  resolution: ExportResolution,
  durationSeconds: number,
): number {
  return (bitrateFor(quality, resolution) / 8) * Math.max(0, durationSeconds);
}

export function buildVideoEncoderConfig(options: ExportEncoderProbeOptions): ExportEncoderConfig {
  return buildVideoEncoderConfigCandidates(options)[0];
}

function createVideoEncoderConfig(
  options: ExportEncoderProbeOptions,
  latencyMode: ExportEncoderConfig['latencyMode'],
  bitrateMode: ExportEncoderConfig['bitrateMode'],
  hardwareAcceleration?: ExportEncoderConfig['hardwareAcceleration'],
): ExportEncoderConfig {
  const isVp9 = options.format === 'webm';

  return {
    codec: codecForFormat(options.format),
    width: normalizeEvenDimension(options.width),
    height: normalizeEvenDimension(options.height),
    bitrate: bitrateFor(options.quality, options.resolution),
    framerate: options.fps,
    hardwareAcceleration: hardwareAcceleration ?? (isVp9 ? 'prefer-software' : 'prefer-hardware'),
    latencyMode,
    bitrateMode,
    // Signals screen recording content to the encoder so it preserves fine details
    // (sharp text edges, crisp UI elements) rather than optimising for natural video.
    contentHint: 'detail',
  };
}

function dedupeConfigs(configs: ExportEncoderConfig[]): ExportEncoderConfig[] {
  const seen = new Set<string>();
  return configs.filter((config) => {
    const key = [
      config.codec,
      config.width,
      config.height,
      config.bitrate,
      config.framerate,
      config.hardwareAcceleration ?? '',
      config.latencyMode ?? '',
      config.bitrateMode ?? '',
      config.contentHint ?? '',
    ].join(':');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function buildVideoEncoderConfigCandidates(
  options: ExportEncoderProbeOptions,
): ExportEncoderConfig[] {
  const isVp9 = options.format === 'webm';
  const qualityConstant = createVideoEncoderConfig(options, 'quality', 'constant');
  const qualityVariable = createVideoEncoderConfig(options, 'quality', 'variable');
  const realtimeConstant = createVideoEncoderConfig(options, 'realtime', 'constant');
  const realtimeVariable = createVideoEncoderConfig(options, 'realtime', 'variable');

  if (isVp9) {
    // VP9 software encoder: prefer quality+VBR for best output; CBR not guaranteed.
    return dedupeConfigs([qualityVariable, realtimeVariable, realtimeConstant]);
  }

  // H.264 hardware (VideoToolbox): quality+CBR first for best per-frame quality on
  // export (not live). Falls back to realtime+CBR which is the most universally
  // compatible mode on Apple Silicon. realtime+variable is last because on some
  // macOS/VideoToolbox versions it passes isConfigSupported but hangs during encoding.
  //
  // Software (OpenH264) candidates follow the same ladder — Linux Chromium has no
  // hardware WebCodecs H.264 encoder, and Windows/macOS machines with broken
  // drivers land here too, instead of failing the export outright.
  return dedupeConfigs([
    qualityConstant,
    realtimeConstant,
    realtimeVariable,
    qualityVariable,
    createVideoEncoderConfig(options, 'quality', 'constant', 'prefer-software'),
    createVideoEncoderConfig(options, 'realtime', 'constant', 'prefer-software'),
    createVideoEncoderConfig(options, 'realtime', 'variable', 'prefer-software'),
    createVideoEncoderConfig(options, 'quality', 'variable', 'prefer-software'),
  ]);
}

export interface ExportEncoderProbeOptions {
  format: ExportFormat;
  quality: ExportQuality;
  resolution: ExportResolution;
  width: number;
  height: number;
  fps: number;
}

export interface SupportedExportTarget {
  width: number;
  height: number;
  capped: boolean;
  config: ResolvedExportEncoderConfig;
}

function mergeSupportedConfig(
  requestedConfig: ExportEncoderConfig,
  supportedConfig: ResolvedExportEncoderConfig | undefined,
): ResolvedExportEncoderConfig {
  return {
    ...(supportedConfig ?? requestedConfig),
    // Chromium often omits optional knobs from support.config. Preserve the
    // policy we successfully probed so configure() does not silently downgrade.
    latencyMode: requestedConfig.latencyMode,
    bitrateMode: requestedConfig.bitrateMode,
    hardwareAcceleration: requestedConfig.hardwareAcceleration,
  };
}

export async function resolveSupportedVideoEncoderConfig(
  options: ExportEncoderProbeOptions,
): Promise<ResolvedVideoEncoderConfig | null> {
  const videoEncoder = (
    globalThis as typeof globalThis & { VideoEncoder?: VideoEncoderSupportProbe }
  ).VideoEncoder;
  if (!videoEncoder || typeof videoEncoder.isConfigSupported !== 'function') {
    return null;
  }

  const width = normalizeEvenDimension(options.width);
  const height = normalizeEvenDimension(options.height);
  const cacheKey = buildEncoderSupportCacheKey({ ...options, width, height });
  const cached = encoderSupportCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const candidates = buildVideoEncoderConfigCandidates({ ...options, width, height });

  for (const config of candidates) {
    try {
      const support = await videoEncoder.isConfigSupported(config);
      if (!support.supported) {
        continue;
      }

      const resolved: ResolvedVideoEncoderConfig = {
        requestedConfig: config,
        config: mergeSupportedConfig(config, support.config),
      };
      encoderSupportCache.set(cacheKey, resolved);
      return resolved;
    } catch {
      // Keep probing lower-risk configs; some Chromium builds throw when a
      // latency or bitrate mode is unknown rather than returning supported:false.
    }
  }

  encoderSupportCache.set(cacheKey, null);
  return null;
}

export async function resolveSupportedExportTarget(
  options: ExportEncoderProbeOptions,
): Promise<SupportedExportTarget | null> {
  const normalizedWidth = normalizeEvenDimension(options.width);
  const normalizedHeight = normalizeEvenDimension(options.height);
  const cacheKey = buildEncoderSupportCacheKey({
    ...options,
    width: normalizedWidth,
    height: normalizedHeight,
  });
  const cached = supportedTargetCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const directConfig = await resolveSupportedVideoEncoderConfig({
    ...options,
    width: normalizedWidth,
    height: normalizedHeight,
  });
  if (directConfig) {
    const result: SupportedExportTarget = {
      width: normalizedWidth,
      height: normalizedHeight,
      capped: false,
      config: directConfig.config,
    };
    supportedTargetCache.set(cacheKey, result);
    return result;
  }

  let bestResult: SupportedExportTarget | null = null;
  let low = 1;
  let high = 1000;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const scale = mid / 1000;
    const candidate = scaleDimensions(normalizedWidth, normalizedHeight, scale);
    const candidateConfig = await resolveSupportedVideoEncoderConfig({
      ...options,
      width: candidate.width,
      height: candidate.height,
    });

    if (candidateConfig) {
      bestResult = {
        width: candidate.width,
        height: candidate.height,
        capped: candidate.width !== normalizedWidth || candidate.height !== normalizedHeight,
        config: candidateConfig.config,
      };
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  supportedTargetCache.set(cacheKey, bestResult);
  return bestResult;
}

export function clearExportSupportCachesForTests(): void {
  encoderSupportCache.clear();
  supportedTargetCache.clear();
}
