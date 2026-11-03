import { createScreenforgeFileUrl } from '../screenforge-url';
import { ALL_FORMATS, CanvasSink, Input, UrlSource } from 'mediabunny';
import type { RenderSource } from '../effects/types';
import { VIDEO_DECODE_STALL_ERROR } from './captureScheduling';

const EXPORT_FRAME_CANVAS_POOL_SIZE = 8;

export interface ExportVideoFrameSource {
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  framesAtTimestamps(
    timestamps: Iterable<number>,
    signal?: AbortSignal,
  ): AsyncGenerator<RenderSource | null, void, unknown>;
  dispose(): void;
}

interface ExportVideoFrameSourceOptions {
  filePath: string;
}

function toRenderSource(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  width: number,
  height: number,
): RenderSource {
  return {
    source: canvas,
    width,
    height,
    ready: true,
  };
}

export async function createExportVideoFrameSource(
  options: ExportVideoFrameSourceOptions,
): Promise<ExportVideoFrameSource> {
  const input = new Input({
    source: new UrlSource(createScreenforgeFileUrl(options.filePath)),
    formats: ALL_FORMATS,
  });

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    input.dispose();
    throw new Error('Recording source does not contain a video track');
  }

  if (!(await videoTrack.canDecode())) {
    input.dispose();
    throw new Error('Recording source video track cannot be decoded for export');
  }

  const sink = new CanvasSink(videoTrack, {
    poolSize: EXPORT_FRAME_CANVAS_POOL_SIZE,
  });
  const width = videoTrack.displayWidth;
  const height = videoTrack.displayHeight;
  const duration = await videoTrack.computeDuration();

  return {
    width,
    height,
    duration,
    async *framesAtTimestamps(timestamps, signal) {
      try {
        for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
          if (signal?.aborted) {
            throw new Error('Export rendering cancelled');
          }

          if (!wrapped) {
            yield null;
            continue;
          }

          yield toRenderSource(wrapped.canvas, width, height);
        }
      } catch (error) {
        if (signal?.aborted) {
          throw new Error('Export rendering cancelled');
        }

        const message = error instanceof Error ? error.message : '';
        throw new Error(message || VIDEO_DECODE_STALL_ERROR);
      }
    },
    dispose() {
      input.dispose();
    },
  };
}
