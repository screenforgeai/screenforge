import { describe, expect, it } from 'vitest';
import { buildMuxerWritePlan, toEncodedVideoChunkMetadata } from './muxing';

describe('buildMuxerWritePlan', () => {
  const decoderConfig = {
    codec: 'avc1.640034',
    codedWidth: 1920,
    codedHeight: 1080,
    description: new Uint8Array([1, 2, 3, 4]).buffer,
  };

  it('attaches decoder config only to the first keyframe when a batch starts the stream', () => {
    const plan = buildMuxerWritePlan(
      [
        {
          data: new Uint8Array([10]).buffer,
          type: 'key',
          timestamp: 0,
          duration: 16_667,
        },
        {
          data: new Uint8Array([20]).buffer,
          type: 'delta',
          timestamp: 16_667,
          duration: 16_667,
        },
        {
          data: new Uint8Array([30]).buffer,
          type: 'key',
          timestamp: 33_334,
          duration: 16_667,
        },
      ],
      decoderConfig,
      false,
    );

    expect(plan.firstChunkSent).toBe(true);
    expect(plan.writes[0].meta?.decoderConfig.codec).toBe(decoderConfig.codec);
    expect(plan.writes[0].meta?.decoderConfig.codedWidth).toBe(decoderConfig.codedWidth);
    expect(plan.writes[0].meta?.decoderConfig.codedHeight).toBe(decoderConfig.codedHeight);
    expect(
      Array.from(
        new Uint8Array(plan.writes[0].meta?.decoderConfig.description ?? new ArrayBuffer(0)),
      ),
    ).toEqual([1, 2, 3, 4]);
    expect(plan.writes[1].meta).toBeUndefined();
    expect(plan.writes[2].meta).toBeUndefined();
  });

  it('does not re-attach decoder config after the first keyframe was already written', () => {
    const plan = buildMuxerWritePlan(
      [
        {
          data: new Uint8Array([40]).buffer,
          type: 'key',
          timestamp: 50_000,
          duration: 16_667,
        },
      ],
      decoderConfig,
      true,
    );

    expect(plan.firstChunkSent).toBe(true);
    expect(plan.writes[0].meta).toBeUndefined();
  });

  it('preserves the firstChunkSent flag when no keyframe appears yet', () => {
    const plan = buildMuxerWritePlan(
      [
        {
          data: new Uint8Array([50]).buffer,
          type: 'delta',
          timestamp: 16_667,
          duration: 16_667,
        },
      ],
      decoderConfig,
      false,
    );

    expect(plan.firstChunkSent).toBe(false);
    expect(plan.writes[0].meta).toBeUndefined();
  });

  it('converts serialized decoder config back into video chunk metadata', () => {
    expect(toEncodedVideoChunkMetadata(decoderConfig)).toEqual({
      decoderConfig: {
        codec: decoderConfig.codec,
        codedWidth: decoderConfig.codedWidth,
        codedHeight: decoderConfig.codedHeight,
        displayAspectWidth: undefined,
        displayAspectHeight: undefined,
        description: decoderConfig.description,
      },
    });
  });
});
