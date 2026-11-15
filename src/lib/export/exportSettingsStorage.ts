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

const FORMATS: readonly ExportSettings['format'][] = ['mp4', 'mov', 'webm', 'gif'];
const RESOLUTIONS: readonly ExportSettings['resolution'][] = ['720p', '1080p', '4k'];
const QUALITIES: readonly ExportSettings['quality'][] = ['fast', 'balanced', 'high'];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** The export dialog's last-used settings, or the defaults. */
export function loadStoredExportSettings(): StoredExportSettings {
  try {
    const raw = localStorage.getItem(EXPORT_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_EXPORT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_EXPORT_SETTINGS;
    }
    // A value this version does not know falls back to its default.
    const format = pick(parsed.format, FORMATS, DEFAULT_EXPORT_SETTINGS.format);
    return {
      format,
      resolution: pick(parsed.resolution, RESOLUTIONS, DEFAULT_EXPORT_SETTINGS.resolution),
      fps: normalizeExportFpsForFormat(
        format,
        typeof parsed.fps === 'number' ? parsed.fps : DEFAULT_EXPORT_SETTINGS.fps,
      ),
      quality: pick(parsed.quality, QUALITIES, DEFAULT_EXPORT_SETTINGS.quality),
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
