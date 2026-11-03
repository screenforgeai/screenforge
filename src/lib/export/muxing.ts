import type { SerializedChunk, SerializedDecoderConfig } from '../../types';

export interface SerializedVideoChunkMetadata {
  decoderConfig: SerializedDecoderConfig;
}

export interface MuxerWritePlanEntry {
  data: Uint8Array;
  type: SerializedChunk['type'];
  timestamp: number;
  duration: number;
  meta?: SerializedVideoChunkMetadata | undefined;
}

export interface MuxerWritePlan {
  writes: MuxerWritePlanEntry[];
  firstChunkSent: boolean;
}

export function buildMuxerWritePlan(
  chunks: SerializedChunk[],
  decoderConfig: SerializedDecoderConfig | null,
  firstChunkSent: boolean,
): MuxerWritePlan {
  let didSendFirstChunk = firstChunkSent;

  const writes = chunks.map((chunk) => {
    const meta =
      !didSendFirstChunk && chunk.type === 'key' && decoderConfig
        ? {
            decoderConfig: {
              codec: decoderConfig.codec,
              codedWidth: decoderConfig.codedWidth,
              codedHeight: decoderConfig.codedHeight,
              displayAspectWidth: decoderConfig.displayAspectWidth,
              displayAspectHeight: decoderConfig.displayAspectHeight,
              description: decoderConfig.description
                ? decoderConfig.description.slice(0)
                : undefined,
            },
          }
        : undefined;

    if (!didSendFirstChunk && chunk.type === 'key') {
      didSendFirstChunk = true;
    }

    return {
      data: new Uint8Array(chunk.data),
      type: chunk.type,
      timestamp: chunk.timestamp,
      duration: chunk.duration,
      meta,
    };
  });

  return {
    writes,
    firstChunkSent: didSendFirstChunk,
  };
}

export function toEncodedVideoChunkMetadata(
  decoderConfig: SerializedDecoderConfig,
): EncodedVideoChunkMetadata {
  return {
    decoderConfig: {
      codec: decoderConfig.codec,
      codedWidth: decoderConfig.codedWidth,
      codedHeight: decoderConfig.codedHeight,
      displayAspectWidth: decoderConfig.displayAspectWidth,
      displayAspectHeight: decoderConfig.displayAspectHeight,
      description: decoderConfig.description,
    },
  };
}
