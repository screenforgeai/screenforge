import {
  EncodedPacket,
  EncodedVideoPacketSource,
  FilePathTarget,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';
import type { ExportFormat, SerializedChunk, SerializedDecoderConfig } from '../../../src/types';
import { buildMuxerWritePlan, toEncodedVideoChunkMetadata } from '../../../src/lib/export/muxing';
import log from '../../lib/logger';

type SupportedMuxFormat = Exclude<ExportFormat, 'gif'>;

export interface ExportVideoMuxer {
  readonly videoPath: string;
  writeEncodedChunks(chunks: SerializedChunk[]): Promise<void>;
  finalize(): Promise<string>;
  cancel(): Promise<void>;
}

function createOutputFormat(format: SupportedMuxFormat) {
  if (format === 'webm') {
    return new WebMOutputFormat();
  }
  if (format === 'mov') {
    return new MovOutputFormat();
  }
  return new Mp4OutputFormat();
}

function codecForMuxFormat(format: SupportedMuxFormat): 'avc' | 'vp9' {
  return format === 'webm' ? 'vp9' : 'avc';
}

interface CreateExportVideoMuxerOptions {
  format: SupportedMuxFormat;
  videoPath: string;
  decoderConfig: SerializedDecoderConfig | null;
  fps: number;
}

export async function createExportVideoMuxer(
  options: CreateExportVideoMuxerOptions,
): Promise<ExportVideoMuxer> {
  const output = new Output({
    format: createOutputFormat(options.format),
    target: new FilePathTarget(options.videoPath),
  });
  const videoSource = new EncodedVideoPacketSource(codecForMuxFormat(options.format));
  output.addVideoTrack(videoSource, { frameRate: options.fps });
  await output.start();

  let firstChunkSent = false;
  let nextSequenceNumber = 0;
  let finalized = false;
  let canceled = false;
  let finalizePromise: Promise<void> | null = null;
  let batchIndex = 0;
  let totalWriteMs = 0;

  return {
    videoPath: options.videoPath,
    async writeEncodedChunks(chunks) {
      if (canceled) {
        throw new Error('Cannot write encoded chunks after muxer cancellation');
      }
      if (finalized) {
        throw new Error('Cannot write encoded chunks after muxer finalization');
      }

      const batchStartedAt = performance.now();
      batchIndex += 1;

      const plan = buildMuxerWritePlan(chunks, options.decoderConfig, firstChunkSent);
      for (const chunk of plan.writes) {
        const packet = new EncodedPacket(
          chunk.data,
          chunk.type,
          chunk.timestamp / 1_000_000,
          chunk.duration / 1_000_000,
          nextSequenceNumber,
        );
        nextSequenceNumber += 1;

        await videoSource.add(
          packet,
          chunk.meta ? toEncodedVideoChunkMetadata(chunk.meta.decoderConfig) : undefined,
        );
      }

      firstChunkSent = plan.firstChunkSent;

      const batchMs = performance.now() - batchStartedAt;
      totalWriteMs += batchMs;
    },
    async finalize() {
      if (canceled) {
        throw new Error('Cannot finalize a canceled muxer');
      }
      if (!finalizePromise) {
        const finalizeStartedAt = performance.now();
        log.info(
          `[export:muxer] finalize started totalBatches=${batchIndex} totalWriteMs=${Math.round(totalWriteMs)}`,
        );
        finalizePromise = output
          .finalize()
          .then(() => {
            if (canceled) {
              throw new Error('Muxer finalization cancelled');
            }
            finalized = true;
            log.info(
              `[export:muxer] finalize done durationMs=${Math.round(performance.now() - finalizeStartedAt)}`,
            );
          })
          .catch((error: unknown) => {
            if (canceled) {
              throw new Error('Muxer finalization cancelled');
            }
            throw error;
          });
      }
      await finalizePromise;
      return options.videoPath;
    },
    async cancel() {
      if (canceled) {
        return;
      }
      canceled = true;
      if (finalized) {
        return;
      }
      await output.cancel().catch(() => undefined);
    },
  };
}
