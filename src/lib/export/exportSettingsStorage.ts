import type { CaptionSettings, ExportSettings } from '../../types';
import { normalizeExportFpsForFormat } from './gif';

export const EXPORT_SETTINGS_STORAGE_KEY = 'screenforge.export.settings.v2';

export type StoredExportSettings = Pick<
  ExportSettings,
  'format' | 'resolution' | 'fps' | 'quality'
>;

export const DEFAULT_EXPORT_SETTINGS: StoredExportSettings = {
  format: 'mp4',
  resolution: '1080p',
  fps: 60,
  quality: 'high',
};

export const EXPORT_QUALITY_PRESET: Record<
  ExportSettings['quality'],
  Pick<ExportSettings, 'audioBitrateKbps'>
> = {
  fast: { audioBitrateKbps: 128 },
  balanced: { audioBitrateKbps: 192 },
  high: { audioBitrateKbps: 320 },
};

/** The export dialog's last-used settings, or the defaults. */
export function loadStoredExportSettings(): StoredExportSettings {
  try {
    const raw = localStorage.getItem(EXPORT_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_EXPORT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<ExportSettings>;
    const format = parsed.format ?? DEFAULT_EXPORT_SETTINGS.format;
    return {
      format,
      resolution: parsed.resolution ?? DEFAULT_EXPORT_SETTINGS.resolution,
      fps: normalizeExportFpsForFormat(format, parsed.fps ?? DEFAULT_EXPORT_SETTINGS.fps),
      quality: parsed.quality ?? DEFAULT_EXPORT_SETTINGS.quality,
    };
  } catch {
    return DEFAULT_EXPORT_SETTINGS;
  }
}

/** The settings an export runs with, as the export dialog builds them. */
export function buildExportSettings(
  settings: StoredExportSettings,
  captions: Pick<CaptionSettings, 'captionsEnabled' | 'segments'>,
): ExportSettings {
  return {
    quality: settings.quality,
    format: settings.format,
    resolution: settings.resolution,
    fps: settings.fps,
    // GIF has no audio track
    includeAudio: settings.format !== 'gif',
    burnCaptions: captions.captionsEnabled && captions.segments.length > 0,
    ...EXPORT_QUALITY_PRESET[settings.quality],
  };
}
