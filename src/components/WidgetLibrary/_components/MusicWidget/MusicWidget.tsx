import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { trackEvent } from 'src/lib/analytics';
import { useStore } from 'src/store';
import type { MusicClip } from 'src/store';
import { Button, Slider } from 'src/lib/ui';
import { IconFileMusic, IconMusic3, IconPlus, IconX } from 'src/lib/icons';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { cn, formatTime } from 'src/lib/utils';

const ACCEPTED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac'];
const ACCEPTED_MIME = 'audio/mpeg,audio/wav,audio/x-m4a,audio/aac';

export const MusicWidget = () => {
  const { t } = useTranslation('music');

  const {
    musicClips,
    currentProjectId,
    recordingResult,
    mediaSegments,
    setMusicClips,
    selectedClip,
    setSelectedClip,
    beginHistoryGroup,
    endHistoryGroup,
    currentTime,
  } = useStore(
    useShallow((s) => ({
      musicClips: s.musicClips,
      currentProjectId: s.currentProjectId,
      recordingResult: s.recordingResult,
      mediaSegments: s.mediaSegments,
      setMusicClips: s.setMusicClips,
      selectedClip: s.selectedClip,
      setSelectedClip: s.setSelectedClip,
      beginHistoryGroup: s.beginHistoryGroup,
      endHistoryGroup: s.endHistoryGroup,
      currentTime: s.currentTime,
    })),
  );

  const totalVideoDur = (() => {
    const raw =
      mediaSegments.length > 0
        ? mediaSegments.reduce((max, seg) => Math.max(max, seg.timelineEnd), 0)
        : (recordingResult?.duration ?? 0);
    return raw > 0 ? raw : 60;
  })();

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clipRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const expandedId = selectedClip?.effectId === 'music' ? selectedClip.id : null;

  const playheadClipId =
    musicClips.find((c) => currentTime >= c.timelineStart && currentTime <= c.timelineEnd)?.id ??
    null;

  useEffect(() => {
    if (!playheadClipId) {
      return;
    }
    clipRefs.current[playheadClipId]?.scrollIntoView({ block: 'nearest' });
  }, [playheadClipId]);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        toast.error(t('errorUnsupportedType'));
        return;
      }

      const filePath = window.screenforge.getPathForFile(file);
      if (!filePath) {
        toast.error(t('errorReadPath'));
        return;
      }

      const projectId = currentProjectId ?? 'default';
      setUploading(true);
      try {
        const originalName = file.name.replace(/\.[^.]+$/, '');
        const { filePath: savedPath, duration } = await window.screenforge.saveMusic(
          filePath,
          projectId,
        );
        const newClip: MusicClip = {
          id: `music-${Date.now()}`,
          name: originalName,
          filePath: savedPath,
          startTime: 0,
          duration,
          timelineStart: 0,
          timelineEnd: Math.min(duration, totalVideoDur),
          fitToVideo: false,
          volume: 0.5,
        };
        setMusicClips([...musicClips, newClip]);
        useStore.getState().setLayerHidden('music', false);
        trackEvent('music_clip_added', { source: 'widget' });
        setSelectedClip({
          id: newClip.id,
          start: newClip.timelineStart,
          end: newClip.timelineEnd,
          effectId: 'music',
        });
      } catch {
        toast.error(t('errorSaveFailed'));
      } finally {
        setUploading(false);
      }
    },
    [currentProjectId, musicClips, setMusicClips, setSelectedClip, t, totalVideoDur],
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleFile(file);
    }
    e.target.value = '';
  };

  const deleteClip = (clipId: string) => {
    const next = musicClips.filter((c) => c.id !== clipId);
    setMusicClips(next);
    if (next.length === 0) {
      useStore.getState().setLayerHidden('music', true);
    }
    if (expandedId === clipId) {
      setSelectedClip(null);
    }
    trackEvent('music_clip_deleted', { source: 'widget' });
  };

  const updateClip = (clipId: string, patch: Partial<MusicClip>) => {
    setMusicClips(musicClips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)));
  };

  if (!recordingResult) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={WIDGET_PANEL_HEADER_CLASS}>
          <IconMusic3 className="size-4.5" />
          {t('header')}
        </div>
        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconMusic3 size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={WIDGET_PANEL_HEADER_CLASS}>
        <IconMusic3 className="size-4.5" />
        {t('header')}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_MIME}
        className="hidden"
        onChange={handleInputChange}
      />

      {/* Add button */}
      <div className="shrink-0 px-3 flex flex-col gap-2 pt-1">
        <Button
          size="md"
          variant="secondary"
          className="w-full gap-1.5"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <IconPlus size={14} />
          {uploading ? t('saving') : t('addMusic')}
        </Button>
      </div>

      {/* Clip list */}
      <div className="mt-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-6">
        {musicClips.length === 0 && (
          <div className={WIDGET_EMPTY_STATE_CLASS}>
            <IconFileMusic size={34} className="text-sf-muted" />
            <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noMusicTracks')}</div>
            <p className="text-xs text-sf-muted text-center">{t('noMusicTracksDesc')}</p>
          </div>
        )}

        {musicClips.map((clip, index) => {
          const isExpanded = expandedId === clip.id;
          const isPlayheadActive = playheadClipId === clip.id;
          const isHighlighted = isExpanded || isPlayheadActive;
          const trackLabel = t('track', { n: index + 1 });

          return (
            <div
              key={clip.id}
              ref={(node) => {
                clipRefs.current[clip.id] = node;
              }}
              className={cn(
                'overflow-hidden rounded-md border bg-sf-panel transition-[border-color,box-shadow,background-color]',
                isHighlighted
                  ? 'border-sf-border-lt bg-[#151519] shadow-[0_0_0_1px_var(--color-sf-border-lt),0_10px_24px_rgba(0,0,0,0.18)]'
                  : 'border-sf-border hover:border-sf-border-lt',
              )}
            >
              {/* Row header */}
              <div className="group flex items-center gap-2 px-2 py-2">
                <button
                  type="button"
                  className="min-w-0 flex flex-1 cursor-pointer items-center gap-2 rounded-md px-0.5 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sf-border-lt"
                  aria-expanded={isExpanded}
                  aria-current={isPlayheadActive ? 'true' : undefined}
                  onClick={() => {
                    if (isExpanded) {
                      setSelectedClip(null);
                    } else {
                      setSelectedClip({
                        id: clip.id,
                        start: clip.timelineStart,
                        end: clip.timelineEnd,
                        effectId: 'music',
                      });
                    }
                  }}
                >
                  <IconFileMusic size={14} className="shrink-0 text-sf-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="text-md font-medium text-sf-primary">{trackLabel}</div>
                      {isPlayheadActive && (
                        <span className="rounded-full border border-sf-border-lt/70 bg-sf-border-lt/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-primary">
                          {t('live')}
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 text-sm font-mono text-sf-secondary',
                        isPlayheadActive && 'text-sf-primary/85',
                      )}
                    >
                      {formatTime(clip.timelineStart)} → {formatTime(clip.timelineEnd)}
                    </div>
                  </div>
                </button>

                <Button
                  variant="ghost"
                  className={cn(
                    'transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
                    isExpanded ? 'opacity-100' : 'opacity-0',
                  )}
                  size="icon-xs"
                  aria-label={t('ariaDelete')}
                  onClick={() => deleteClip(clip.id)}
                >
                  <IconX />
                </Button>
              </div>

              {/* Expanded config */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    key="panel"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="border-t border-sf-border px-3 py-3 flex flex-col gap-4">
                      <div className="flex flex-col gap-2">
                        <div className={WIDGET_SECTION_HEADING_CLASS}>{t('volume')}</div>
                        <Slider
                          min={0}
                          max={1}
                          step={0.01}
                          inlineLabel={t('volume')}
                          valueLabel={`${Math.round(clip.volume * 100)}%`}
                          value={[clip.volume]}
                          onPointerDown={() =>
                            beginHistoryGroup(`music-vol-${clip.id}`, 'Adjust music volume')
                          }
                          onValueChange={([v]) => updateClip(clip.id, { volume: v })}
                          onValueCommit={([v]) => {
                            endHistoryGroup(`music-vol-${clip.id}`);
                            trackEvent('music_clip_volume_changed', {
                              volume: Math.round(v * 100),
                            });
                          }}
                        />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
};
