import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  ExportSettings,
  ProjectCameraSettings,
  ProjectCursorSettings,
  ProjectKeyboardSettings,
  RecordingResult,
  ExportCapturePerfStats,
} from '../../src/types';
import type { MediaSegment, ZoomClip } from '../../src/types/timeline';
import type { MotionClip } from '../../src/lib/animation/motionClips';
import { normalizeMotionClips } from '../../src/lib/animation/motionClips';
import type { FrameSettings } from '../../src/lib/effects/frame';
import { cloneFrameSettings, DEFAULT_FRAME } from '../../src/lib/effects/frame';
import {
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_CURSOR_SETTINGS,
  DEFAULT_KEYBOARD_SETTINGS,
} from '../../src/store/defaults';

type PartialFrameSettings = Partial<Omit<FrameSettings, 'background' | 'cropRect'>> & {
  background?: Partial<FrameSettings['background']>;
  cropRect?: Partial<FrameSettings['cropRect']>;
};

type PartialCameraSettings = Partial<Omit<ProjectCameraSettings, 'shadow'>> & {
  shadow?: Partial<ProjectCameraSettings['shadow']>;
};

export interface ExportFixtureManifest {
  id: string;
  description: string;
  recording: RecordingResult;
  mediaSegments: MediaSegment[];
  zoomClips?: ZoomClip[];
  motionClips?: MotionClip[];
  frame?: PartialFrameSettings;
  camera?: PartialCameraSettings;
  keyboard?: Partial<ProjectKeyboardSettings>;
  cursor?: Partial<ProjectCursorSettings>;
  export: ExportSettings & {
    outputFileName: string;
  };
  expected: {
    audio: boolean;
    moving: boolean;
    durationToleranceSeconds: number;
    minDistinctFrameHashes: number;
    outputDurationSeconds?: number;
    maxElapsedMs?: number;
  };
}

export interface ResolvedExportFixtureManifest extends Omit<
  ExportFixtureManifest,
  'camera' | 'cursor' | 'frame' | 'keyboard'
> {
  frame: FrameSettings;
  camera: ProjectCameraSettings;
  keyboard: ProjectKeyboardSettings;
  cursor: ProjectCursorSettings;
  manifestPath: string;
}

export interface ExportHarnessResult {
  success: boolean;
  manifestId: string;
  outputPath?: string;
  captureFrameCount?: number;
  effectiveFps?: number;
  duration?: number;
  targetWidth?: number;
  targetHeight?: number;
  sourceInfo?: {
    fps: number | null;
    width: number | null;
    height: number | null;
    duration: number | null;
  };
  outputInfo?: {
    fps: number | null;
    width: number | null;
    height: number | null;
    duration: number | null;
  };
  capturePerf?: ExportCapturePerfStats;
  elapsedMs: number;
  error?: string;
  stallError?: boolean;
}

function resolveMaybePath(manifestPath: string, filePath?: string): string | undefined {
  if (!filePath) {
    return undefined;
  }

  return path.isAbsolute(filePath) ? filePath : path.resolve(path.dirname(manifestPath), filePath);
}

function resolveRecordingPaths(manifestPath: string, recording: RecordingResult): RecordingResult {
  return {
    ...recording,
    filePath: resolveMaybePath(manifestPath, recording.filePath) ?? recording.filePath,
    audioPath: resolveMaybePath(manifestPath, recording.audioPath),
    cameraPath: resolveMaybePath(manifestPath, recording.cameraPath),
  };
}

function mergeFrameSettings(override?: PartialFrameSettings): FrameSettings {
  const base = cloneFrameSettings(DEFAULT_FRAME);
  if (!override) {
    return base;
  }

  return {
    aspectRatioId: override.aspectRatioId ?? base.aspectRatioId,
    cropRect: {
      ...base.cropRect,
      ...override.cropRect,
    },
    background: {
      ...base.background,
      ...override.background,
    },
  };
}

function mergeCameraSettings(override?: PartialCameraSettings): ProjectCameraSettings {
  return {
    ...DEFAULT_CAMERA_SETTINGS,
    ...override,
    shadow: {
      ...DEFAULT_CAMERA_SETTINGS.shadow,
      ...override?.shadow,
    },
  };
}

function mergeCursorSettings(override?: Partial<ProjectCursorSettings>): ProjectCursorSettings {
  return {
    ...DEFAULT_CURSOR_SETTINGS,
    ...override,
  };
}

function mergeKeyboardSettings(
  override?: Partial<ProjectKeyboardSettings>,
): ProjectKeyboardSettings {
  const rawSize = override?.size;
  const rawBackground = override?.background;
  return {
    ...DEFAULT_KEYBOARD_SETTINGS,
    ...override,
    size:
      rawSize === 'small' || rawSize === 'medium' || rawSize === 'large'
        ? rawSize
        : DEFAULT_KEYBOARD_SETTINGS.size,
    background:
      rawBackground === 'dark' || rawBackground === 'light' || rawBackground === 'warm'
        ? rawBackground
        : DEFAULT_KEYBOARD_SETTINGS.background,
    position: 'bottom-center',
  };
}

export async function readResolvedExportFixtureManifest(
  manifestPath: string,
): Promise<ResolvedExportFixtureManifest> {
  const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ExportFixtureManifest;

  return {
    ...parsed,
    manifestPath,
    recording: resolveRecordingPaths(manifestPath, parsed.recording),
    zoomClips: parsed.zoomClips ?? [],
    motionClips: normalizeMotionClips(parsed.motionClips),
    frame: mergeFrameSettings(parsed.frame),
    camera: mergeCameraSettings(parsed.camera),
    keyboard: mergeKeyboardSettings(parsed.keyboard),
    cursor: mergeCursorSettings(parsed.cursor),
  };
}
