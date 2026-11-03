import log from '../../../lib/logger';
import { runFFmpeg, type FFmpegJob, type FFmpegProgress } from '../runner';
import type { ExportSettings } from '../../../../src/types/index';

export interface ExportOptions {
  /** Pre-encoded video file path (output of the WebCodecs + Mediabunny capture phase). */
  videoPath: string;
  /** Optional rendered wav path for audio. */
  audioPath?: string;
  outputPath: string;
  settings: ExportSettings;
  onProgress?: (p: FFmpegProgress) => void;
}

export function startExportJob(opts: ExportOptions): FFmpegJob {
  const { videoPath, audioPath, outputPath, settings, onProgress } = opts;
  const { format, includeAudio, audioBitrateKbps } = settings;

  log.info(`[export] mux ${videoPath} ${audioPath ? '+ audio' : ''} → ${outputPath}`);

  // WebM containers require Opus/Vorbis audio — AAC is not valid per the WebM spec
  // and most players will drop audio or refuse to play the file.
  const audioCodec = format === 'webm' ? 'libopus' : 'aac';

  const args = [
    '-y',
    '-i',
    videoPath,
    ...(includeAudio && audioPath ? ['-i', audioPath] : []),
    '-c:v',
    'copy',
    ...(includeAudio && audioPath
      ? [
          '-c:a',
          audioCodec,
          '-b:a',
          `${audioBitrateKbps}k`,
          '-map',
          '0:v:0',
          '-map',
          '1:a:0',
          '-shortest',
        ]
      : ['-an']),
    outputPath,
  ];

  return runFFmpeg(args, outputPath, onProgress);
}

export interface GifExportOptions {
  /** Pre-encoded video file path (temp MP4 from the WebCodecs + Mediabunny capture phase). */
  videoPath: string;
  outputPath: string;
  /** Output frame rate for the GIF. */
  fps: number;
  /** Target width in pixels. Height is derived automatically, rounded to even. */
  width: number;
  onProgress?: (p: FFmpegProgress) => void;
}

export function startGifExportJob(opts: GifExportOptions): FFmpegJob {
  const { videoPath, outputPath, fps, width, onProgress } = opts;

  log.info(`[export] gif ${videoPath} → ${outputPath} (${width}px @ ${fps}fps)`);

  // Two-stream palette-based GIF generation:
  //   1. fps + scale  — normalise frame rate and dimensions
  //   2. split        — duplicate the normalised stream
  //   3. palettegen   — compute an optimal 256-colour palette from stream [s0]
  //   4. paletteuse   — apply the palette with sierra2_4a dithering to [s1]
  // Using -filter_complex so the split/merge graph can reference both streams.
  const filterComplex = [
    `fps=${fps},scale=${width}:-2:flags=lanczos,split[s0][s1]`,
    `[s0]palettegen=max_colors=256:stats_mode=full:reserve_transparent=0[p]`,
    `[s1][p]paletteuse=dither=sierra2_4a[out]`,
  ].join(';');

  const args = [
    '-y',
    '-i',
    videoPath,
    '-filter_complex',
    filterComplex,
    '-map',
    '[out]',
    outputPath,
  ];

  return runFFmpeg(args, outputPath, onProgress);
}
