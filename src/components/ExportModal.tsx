import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { IconFolderOpen, IconHeart, IconX } from 'src/lib/icons';
import type { ExportState } from '../hooks/useVideoExport';
import { useStore } from '../store';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '../lib/ui';
import {
  DEFAULT_VIDEO_EXPORT_FPS,
  getExportFpsOptions,
  isVideoExportFps,
  normalizeExportFpsForFormat,
} from '../lib/export/gif';
import { trackEvent } from '../lib/analytics';
import { estimateDisplayExportSizeBytes } from '../lib/export/estimate';
import { stripExt } from '../lib/utils';
import type { ExportSettings } from '../types';

const KOFI_URL = 'https://ko-fi.com/mohibarshi';

interface ExportModalProps {
  open: boolean;
  recordingName: string;
  exportState: ExportState;
  onClose: () => void;
  onCancelExport: () => void;
  onExport: (outputPath: string, settings: ExportSettings) => Promise<void>;
  onOpenFFmpegSetup: () => void;
}

const SETTINGS_STORAGE_KEY = 'screenforge.export.settings.v2';
const LAST_EXPORT_DIR_STORAGE_KEY = 'screenforge.export.last-dir.v1';

const DEFAULT_SETTINGS: Pick<ExportSettings, 'format' | 'resolution' | 'fps' | 'quality'> = {
  format: 'mp4',
  resolution: '1080p',
  fps: 60,
  quality: 'high',
};

function loadStoredSettings(): Pick<ExportSettings, 'format' | 'resolution' | 'fps' | 'quality'> {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<ExportSettings>;
    const format = parsed.format ?? DEFAULT_SETTINGS.format;
    return {
      format,
      resolution: parsed.resolution ?? DEFAULT_SETTINGS.resolution,
      fps: normalizeExportFpsForFormat(format, parsed.fps ?? DEFAULT_SETTINGS.fps),
      quality: parsed.quality ?? DEFAULT_SETTINGS.quality,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function dirnameFromFilePath(filePath: string): string | null {
  const slashIdx = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (slashIdx <= 0) {
    return null;
  }
  return filePath.slice(0, slashIdx);
}

const QUALITY_PRESET: Record<
  ExportSettings['quality'],
  Pick<ExportSettings, 'audioBitrateKbps'>
> = {
  fast: { audioBitrateKbps: 128 },
  balanced: { audioBitrateKbps: 192 },
  high: { audioBitrateKbps: 320 },
};

function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `~${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  if (bytes >= 1_000_000) {
    return `~${Math.round(bytes / 1_000_000)} MB`;
  }
  return `~${Math.round(bytes / 1000)} KB`;
}

function formatEta(seconds: number): string {
  if (seconds < 90) {
    return '< 1 min';
  }
  const mins = Math.round(seconds / 60);
  return `~${mins} min`;
}

const controlCls = 'text-md h-9 border-sf-border bg-sf-panel text-sf-primary';

type TFunction = (key: string) => string;

const progressLabel = (state: ExportState, t: TFunction): string => {
  if (state.status === 'rendering') {
    if (state.progress === 0) {
      return t('preparing');
    }
    if (state.progress >= 0.96) {
      return t('finalizingRender');
    }
    return t('capturingEncoding');
  }
  if (state.status === 'encoding') {
    if (state.progress >= 0.95) {
      return t('writingOutput');
    }
    return t('encodingOutput');
  }
  if (state.status === 'success') {
    return t('exportCompleted');
  }
  if (state.status === 'cancelled') {
    return t('exportCancelled');
  }
  if (state.status === 'error') {
    return t('exportFailed');
  }
  return '';
};

const ExportModal = ({
  open,
  recordingName,
  exportState,
  onClose,
  onCancelExport,
  onExport,
  onOpenFFmpegSetup,
}: ExportModalProps) => {
  const { t } = useTranslation('export');
  const [settings, setSettings] = useState(() => loadStoredSettings());
  const [outputPath, setOutputPath] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(true);
  const [willOverwrite, setWillOverwrite] = useState(false);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const captions = useStore((s) => s.captions);
  const exportStartRef = useRef<number | null>(null);
  // Tracks which (recordingName, format) pair the current outputPath was generated for,
  // so we re-suggest when the recording or format changes even if a path is already set.
  const hydratedKeyRef = useRef<string | null>(null);

  const isExporting = exportState.status === 'rendering' || exportState.status === 'encoding';

  // Reset isSubmitting immediately when the export terminates for any reason.
  // cancelExport() sets status='cancelled' before runExport throws, so without this
  // the Export button stays disabled until the encoder flush completes (can be 60+ s).
  useEffect(() => {
    if (!isExporting) {
      setIsSubmitting(false);
    }
  }, [isExporting]);

  const progressPct = useMemo(
    () => Math.round(Math.max(0, Math.min(1, exportState.progress)) * 100),
    [exportState.progress],
  );

  const exportRecordingResult = useStore((s) => s.recordingResult);
  const exportMediaSegments = useStore((s) => s.mediaSegments);
  const duration = useMemo(() => {
    if (!exportRecordingResult) {
      return 0;
    }
    if (exportMediaSegments.length === 0) {
      return exportRecordingResult.duration;
    }
    return exportMediaSegments.reduce((max, seg) => Math.max(max, seg.timelineEnd), 0);
  }, [exportRecordingResult, exportMediaSegments]);

  const isGif = settings.format === 'gif';
  const fpsOptions = getExportFpsOptions(settings.format);

  // Estimated output file size — shown before export starts
  const estimatedSize = useMemo(() => {
    if (duration <= 0) {
      return null;
    }
    const bytes = estimateDisplayExportSizeBytes({
      format: settings.format,
      quality: settings.quality,
      resolution: settings.resolution,
      fps: settings.fps,
      audioBitrateKbps: QUALITY_PRESET[settings.quality].audioBitrateKbps,
      durationSeconds: duration,
    });
    return formatFileSize(bytes);
  }, [settings.format, settings.quality, settings.resolution, settings.fps, duration]);

  // Keep a ref so the interval can read latest progress without being a dependency.
  const progressPctRef = useRef(progressPct);
  progressPctRef.current = progressPct;

  // Track export start time and compute ETA once per second.
  // progressPct is intentionally NOT in the dep array — we read it via ref so the
  // interval is never torn down mid-export (which caused the ETA to flicker to null).
  useEffect(() => {
    if (!isExporting) {
      exportStartRef.current = null;
      setEtaSeconds(null);
      return;
    }

    exportStartRef.current = Date.now();

    const interval = setInterval(() => {
      const pct = progressPctRef.current;
      if (exportStartRef.current === null || pct <= 0) {
        return;
      }
      const elapsed = (Date.now() - exportStartRef.current) / 1000;
      const total = elapsed / (pct / 100);
      setEtaSeconds(Math.max(0, total - elapsed));
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExporting]);

  useEffect(() => {
    if (!open || isExporting) {
      return;
    }

    const key = `${recordingName}::${settings.format}`;
    // Re-suggest whenever the recording or format changes, even if a path is set.
    if (hydratedKeyRef.current === key && outputPath.trim()) {
      return;
    }

    let cancelled = false;

    const hydrateSuggestedPath = async () => {
      const baseName = stripExt(recordingName.trim() || 'Screenforge Export');
      const preferredDir = localStorage.getItem(LAST_EXPORT_DIR_STORAGE_KEY) ?? undefined;
      const suggested = await window.screenforge.suggestExportPath(
        baseName,
        settings.format,
        preferredDir || undefined,
      );

      if (!cancelled) {
        hydratedKeyRef.current = key;
        setOutputPath(suggested);
        setWillOverwrite(false);
      }
    };

    hydrateSuggestedPath();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isExporting, recordingName, settings.format]);

  // Check FFmpeg availability when modal opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    window.screenforge.checkFFmpegStatus().then(({ available }) => {
      setFfmpegAvailable(available);
    });
  }, [open]);

  // Check whether the current output path already exists on disk.
  useEffect(() => {
    if (!outputPath.trim() || isExporting) {
      setWillOverwrite(false);
      return;
    }

    let cancelled = false;
    window.screenforge.checkFileExists(outputPath.trim()).then((exists) => {
      if (!cancelled) {
        setWillOverwrite(exists);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [outputPath, isExporting]);

  const handleBrowse = async () => {
    const baseName = stripExt(recordingName.trim() || 'Screenforge Export');
    const preferredDir = localStorage.getItem(LAST_EXPORT_DIR_STORAGE_KEY) ?? undefined;
    const picked = await window.screenforge.pickExportPath(
      baseName,
      settings.format,
      preferredDir || undefined,
    );
    if (picked) {
      trackEvent('export_path_browsed');
      setOutputPath(picked);
      hydratedKeyRef.current = `${recordingName}::${settings.format}`;
      const dir = dirnameFromFilePath(picked);
      if (dir) {
        localStorage.setItem(LAST_EXPORT_DIR_STORAGE_KEY, dir);
      }
      setLocalError(null);
      // Native save dialog already shows a "Replace?" prompt, so no inline warning needed.
      setWillOverwrite(false);
    }
  };

  const handleExport = async () => {
    if (!outputPath.trim()) {
      setLocalError(t('selectOutputPath'));
      return;
    }

    setIsSubmitting(true);

    const payload: ExportSettings = {
      quality: settings.quality,
      format: settings.format,
      resolution: settings.resolution,
      fps: settings.fps,
      // GIF has no audio track
      includeAudio: settings.format !== 'gif',
      burnCaptions: captions.captionsEnabled && captions.segments.length > 0,
      ...QUALITY_PRESET[settings.quality],
    };

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    const chosenDir = dirnameFromFilePath(outputPath.trim());
    if (chosenDir) {
      localStorage.setItem(LAST_EXPORT_DIR_STORAGE_KEY, chosenDir);
    }
    setLocalError(null);
    try {
      await onExport(outputPath.trim(), payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="w-[500px] max-w-[94vw] gap-0 overflow-hidden rounded-[14px] border-sf-border bg-sf-bg p-0 shadow-2xl"
        onPointerDownOutside={() => {
          if (!isExporting) {
            onClose();
          }
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5">
          <DialogTitle className="text-lg font-semibold tracking-tight text-sf-primary">
            {t('title')}
          </DialogTitle>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <IconX size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-6 py-5">
          {/* Quality — hidden for GIF (palette-based, quality setting doesn't apply) */}
          {!isGif && (
            <div>
              <label className="mb-2 block text-md font-medium text-sf-secondary">
                {t('quality')}
              </label>
              <Select
                value={settings.quality}
                onValueChange={(v) => {
                  setSettings((prev) => ({ ...prev, quality: v as ExportSettings['quality'] }));
                  trackEvent('export_settings_changed', { property: 'quality', value: v });
                }}
                disabled={isExporting}
              >
                <SelectTrigger className={controlCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">{t('fast')}</SelectItem>
                  <SelectItem value="balanced">{t('balanced')}</SelectItem>
                  <SelectItem value="high">{t('high')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* GIF info banner */}
          {isGif && !isExporting && (
            <p className="rounded-md border border-sf-border bg-sf-panel px-3 py-2 text-md text-sf-secondary">
              {t('gifInfo')}
            </p>
          )}

          {/* Format / Resolution / FPS */}
          <div className="grid grid-cols-3 gap-[10px]">
            <div>
              <label className="mb-2 block text-md font-medium text-sf-secondary">
                {t('format')}
              </label>
              <Select
                value={settings.format}
                onValueChange={(v) => {
                  setSettings((prev) => {
                    const format = v as ExportSettings['format'];
                    const fps =
                      format === 'gif'
                        ? normalizeExportFpsForFormat(format, prev.fps)
                        : isVideoExportFps(prev.fps)
                          ? prev.fps
                          : DEFAULT_VIDEO_EXPORT_FPS;
                    return { ...prev, format, fps };
                  });
                  trackEvent('export_settings_changed', { property: 'format', value: v });
                }}
                disabled={isExporting}
              >
                <SelectTrigger className={controlCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mp4">MP4</SelectItem>
                  <SelectItem value="mov">MOV</SelectItem>
                  <SelectItem value="webm">WebM</SelectItem>
                  <SelectItem value="gif">GIF</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-2 block text-md font-medium text-sf-secondary">
                {t('resolution')}
              </label>
              <Select
                value={settings.resolution}
                onValueChange={(v) => {
                  setSettings((prev) => ({
                    ...prev,
                    resolution: v as ExportSettings['resolution'],
                  }));
                  trackEvent('export_settings_changed', { property: 'resolution', value: v });
                }}
                disabled={isExporting}
              >
                <SelectTrigger className={controlCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="720p">720p</SelectItem>
                  <SelectItem value="1080p">1080p</SelectItem>
                  <SelectItem value="4k">4K</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-2 block text-md font-medium text-sf-secondary">{t('fps')}</label>
              <Select
                value={String(settings.fps)}
                onValueChange={(v) => {
                  setSettings((prev) => ({
                    ...prev,
                    fps: normalizeExportFpsForFormat(prev.format, Number(v)),
                  }));
                  trackEvent('export_settings_changed', { property: 'fps', value: Number(v) });
                }}
                disabled={isExporting}
              >
                <SelectTrigger className={controlCls}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fpsOptions.map((option) => (
                    <SelectItem key={option} value={String(option)}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Save to */}
          <div>
            <label className="mb-2 block text-md font-medium text-sf-secondary">
              {t('saveTo')}
            </label>
            <div className="w-full flex gap-2">
              <div className="w-full ">
                <Input
                  type="text"
                  value={outputPath}
                  readOnly
                  placeholder={t('chooseDest')}
                  className="h-9 flex-1 cursor-text select-text border-sf-border bg-sf-panel text-md text-sf-primary placeholder:text-sf-muted"
                  disabled={isExporting}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="md"
                className="h-9 shrink-0 border-sf-border bg-sf-panel text-sf-secondary hover:text-sf-primary"
                onClick={handleBrowse}
                disabled={isExporting}
              >
                <IconFolderOpen size={14} />
                {t('browse')}
              </Button>
            </div>
          </div>

          {/* Estimated file size — shown only before export starts */}
          {!isExporting && estimatedSize && (
            <p className="text-md text-sf-muted -mt-2">
              {t('estimatedSize')}{' '}
              <span className="tabular-nums text-sf-secondary">{estimatedSize}</span>
            </p>
          )}

          {/* Progress */}
          {isExporting && (
            <div className="rounded-lg border border-sf-border bg-sf-panel px-3 pb-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-md text-sf-secondary">
                  {progressLabel(exportState, t)}{' '}
                  <Spinner className="size-3.5 text-sf-border fill-sf-primary" />
                </span>
                <span className="flex items-center gap-2 text-md text-sf-primary">
                  {etaSeconds !== null && progressPct > 2 && (
                    <span className="tabular-nums text-sf-muted">{formatEta(etaSeconds)}</span>
                  )}
                  <span className="tabular-nums font-medium">{progressPct}%</span>
                </span>
              </div>
              <Progress key={exportState.status} value={progressPct ?? 0} />
              {/* <div className="mt-3 rounded-md">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded border border-sf-border bg-sf-panel px-2 py-1.5 font-mono">
                    <div className="text-sm uppercase tracking-[0.12em] text-sf-secondary">CPU</div>
                    <div className="text-sm font-semibold tabular-nums text-sf-primary">
                      {exportState.resourceStats?.cpuPercent != null
                        ? `${exportState.resourceStats.cpuPercent.toFixed(1)}%`
                        : '--'}
                    </div>
                  </div>
                  <div className="rounded border border-sf-border bg-sf-panel px-2 py-1.5 font-mono">
                    <div className="text-sm uppercase tracking-[0.12em] text-sf-secondary">
                      Memory
                    </div>
                    <div className="text-sm font-semibold tabular-nums text-sf-primary">
                      {exportState.resourceStats?.memoryBytes != null
                        ? formatSize(exportState.resourceStats.memoryBytes)
                        : '--'}
                    </div>
                  </div>
                  <div className="rounded border border-sf-border bg-sf-panel px-2 py-1.5 font-mono">
                    <div className="text-sm uppercase tracking-[0.12em] text-sf-secondary">
                      Phase
                    </div>
                    <div className="text-sm font-semibold uppercase tracking-[0.08em] text-sf-primary">
                      {exportState.resourceStats?.phase ??
                        (exportState.status === 'encoding' ? 'encoding' : 'rendering')}
                    </div>
                  </div>
                </div>
              </div> */}
            </div>
          )}

          {/* Overwrite warning */}
          {willOverwrite && !isExporting && (
            <div className="rounded-lg border border-[#7a5c1e] bg-[#2a1f0e] px-3 py-2 text-md text-[#e8b84b]">
              {t('willOverwrite')}
            </div>
          )}

          {exportState.warnings.length > 0 && (
            <div className="flex flex-col gap-2">
              {exportState.warnings.map((warning, index) => (
                <div
                  key={`${warning}-${index}`}
                  className="rounded-lg border border-[#7a5c1e] bg-[#2a1f0e] px-3 py-2 text-md text-[#e8b84b]"
                >
                  {warning}
                </div>
              ))}
            </div>
          )}

          {/* FFmpeg missing warning */}
          {!ffmpegAvailable && !isExporting && (
            <div className="flex items-center gap-2 rounded-lg border border-[#6f1f2d] bg-[#2c1117] px-3 py-2 text-md text-sf-red">
              <AlertTriangle size={13} className="shrink-0" />
              {t('ffmpegMissing')}
              <button
                className="ml-auto shrink-0 underline underline-offset-2 opacity-80 transition-opacity hover:opacity-100"
                onClick={() => {
                  onClose();
                  onOpenFFmpegSetup();
                }}
              >
                {t('installIt')}
              </button>
            </div>
          )}

          {/* Error */}
          {(localError || exportState.error) && (
            <div className="rounded-lg border border-[#6f1f2d] bg-[#2c1117] px-3 py-2 text-md text-sf-primary">
              {localError ?? exportState.error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-sf-border/40 px-6 pb-[20px] pt-[14px]">
          {!isExporting && (
            <p className="mr-auto text-xs text-sf-muted">
              {t('freeForever')}
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-0.5 underline underline-offset-2 transition-colors hover:text-sf-secondary"
                onClick={() => {
                  trackEvent('kofi_clicked', { source: 'export_modal' });
                  window.screenforge.openExternalUrl(KOFI_URL);
                }}
              >
                {t('supportUs')}
                <IconHeart size={10} className="text-sf-red" />
              </button>
            </p>
          )}
          {isExporting ? (
            <Button variant="destructive" size="sm" onClick={onCancelExport} className="ml-auto">
              {t('cancelExport')}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="md"
                className="border-sf-border text-sf-secondary hover:text-sf-primary"
                onClick={onClose}
              >
                {t('cancel')}
              </Button>
              <Button size="md" onClick={handleExport} disabled={isSubmitting} className="gap-2">
                {isSubmitting && <Spinner className="size-3.5 fill-white text-white/30" />}
                {t('export')}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ExportModal;
