import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../store';
import type { MaskClip } from '../../../store';
import { IconBlur, IconPlus, IconX } from 'src/lib/icons';
import { Button, Slider, ToggleGroup, ToggleGroupItem } from '../../../lib/ui';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { cn, formatTime } from 'src/lib/utils';

const ColorSwatch = ({
  color,
  onChange,
  ariaLabel,
}: {
  color: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="size-7 shrink-0 rounded border border-sf-border transition-[border-color] hover:border-sf-border-lt"
        style={{ backgroundColor: color }}
        onClick={() => ref.current?.click()}
        aria-label={ariaLabel}
      />
      <input
        ref={ref}
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      />
    </>
  );
};

const LiveBadge = ({ label }: { label: string }) => (
  <span className="rounded-full border border-sf-border-lt/70 bg-sf-border-lt/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-primary">
    {label}
  </span>
);

export const MaskWidget = () => {
  const { t } = useTranslation('mask');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const clipRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const {
    recordingResult,
    maskClips,
    currentTime,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
    mediaSegments,
    setActiveWidget,
  } = useStore(
    useShallow((state) => ({
      recordingResult: state.recordingResult,
      maskClips: state.maskClips,
      currentTime: state.currentTime,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
      mediaSegments: state.mediaSegments,
      setActiveWidget: state.setActiveWidget,
    })),
  );

  const totalDuration =
    mediaSegments.length > 0
      ? Math.max(...mediaSegments.map((s) => s.timelineEnd))
      : (recordingResult?.duration ?? 60);

  const handleAddMask = () => {
    const start = currentTime;
    const newMask: MaskClip = {
      id: `mask-${Date.now()}`,
      start,
      end: Math.min(start + 3, totalDuration),
      x: 0.3,
      y: 0.3,
      width: 0.2,
      height: 0.1,
      type: 'blur',
      blurAmount: 20,
      color: '#000000',
    };
    commitEdit('Add mask', (s) => ({ maskClips: [...s.maskClips, newMask] }));
    setActiveWidget('mask');
    setExpandedId(newMask.id);
  };

  const updateMask = (id: string, patch: Partial<MaskClip>) => {
    commitEdit('Update mask', (s) => ({
      maskClips: s.maskClips.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    }));
  };

  const deleteMask = (id: string) => {
    commitEdit('Delete mask', (s) => ({ maskClips: s.maskClips.filter((m) => m.id !== id) }));
    if (expandedId === id) {
      setExpandedId(null);
    }
  };

  if (!recordingResult) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={WIDGET_PANEL_HEADER_CLASS}>
          <IconBlur className="size-4.5" />
          {t('header')}
        </div>
        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconBlur size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={WIDGET_PANEL_HEADER_CLASS}>
        <IconBlur className="size-4.5" />
        {t('header')}
      </div>

      {/* Add button */}
      <div className="shrink-0 px-3 flex flex-col gap-2">
        <Button size="md" variant="secondary" className="w-full gap-1.5" onClick={handleAddMask}>
          <IconPlus size={14} />
          {t('addMask')}
        </Button>
      </div>

      {/* Clip list */}
      <div className="mt-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-6">
        {maskClips.length === 0 && (
          <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
            <IconBlur size={34} className="text-sf-muted" />
            <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noMasks')}</div>
            <p className="text-sm text-sf-secondary">{t('noMasksDesc')}</p>
          </div>
        )}

        {maskClips.map((mask, index) => {
          const isActive = currentTime >= mask.start && currentTime < mask.end;
          const isExpanded = expandedId === mask.id;
          const isHighlighted = isExpanded || isActive;

          return (
            <div
              key={mask.id}
              ref={(node) => {
                clipRefs.current[mask.id] = node;
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
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-0.5 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sf-border-lt"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedId(isExpanded ? null : mask.id)}
                >
                  <IconBlur
                    size={13}
                    className={cn('shrink-0', isHighlighted ? 'text-sf-primary' : 'text-sf-muted')}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'truncate text-sm font-medium',
                          isHighlighted ? 'text-sf-primary' : 'text-sf-secondary',
                        )}
                      >
                        {t('maskN', { n: index + 1 })}
                      </span>
                      {isActive && !isExpanded && <LiveBadge label={t('live')} />}
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 font-mono text-xs text-sf-secondary',
                        isActive && 'text-sf-primary/85',
                      )}
                    >
                      {formatTime(mask.start)} → {formatTime(mask.end)}
                    </div>
                  </div>
                </button>

                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('ariaDelete')}
                  className={cn(
                    'transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
                    isHighlighted ? 'opacity-100' : 'opacity-0',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMask(mask.id);
                  }}
                >
                  <IconX size={12} />
                </Button>
              </div>

              {/* Expanded body */}
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
                    <div className="flex flex-col divide-y divide-[#161515] border-t border-sf-border">
                      {/* Style + blur/color controls in one section */}
                      <div className="flex flex-col gap-3 px-3 py-4">
                        <span className={WIDGET_SECTION_HEADING_CLASS}>{t('style')}</span>
                        <ToggleGroup
                          type="single"
                          size="sm"
                          value={mask.type}
                          className="w-full"
                          onValueChange={(value) => {
                            if (!value) {
                              return;
                            }
                            updateMask(mask.id, { type: value as MaskClip['type'] });
                          }}
                        >
                          <ToggleGroupItem value="blur" className="flex-1 text-md">
                            {t('blur')}
                          </ToggleGroupItem>
                          <ToggleGroupItem value="solid" className="flex-1 text-md">
                            {t('solidFill')}
                          </ToggleGroupItem>
                        </ToggleGroup>

                        {mask.type === 'blur' && (
                          <Slider
                            min={4}
                            max={40}
                            step={1}
                            inlineLabel={t('amount')}
                            valueLabel={`${mask.blurAmount} px`}
                            value={[mask.blurAmount]}
                            onPointerDown={() =>
                              beginHistoryGroup(`mask-blur-${mask.id}`, 'Adjust blur amount')
                            }
                            onValueChange={([v]) => {
                              if (v !== undefined) {
                                updateMask(mask.id, { blurAmount: v });
                              }
                            }}
                            onValueCommit={() => endHistoryGroup(`mask-blur-${mask.id}`)}
                          />
                        )}

                        {mask.type === 'solid' && (
                          <div className="flex items-center gap-2">
                            <ColorSwatch
                              color={mask.color}
                              onChange={(color) => updateMask(mask.id, { color })}
                              ariaLabel={t('pickColor')}
                            />
                            <span className="font-mono text-xs text-sf-secondary">
                              {mask.color.toUpperCase()}
                            </span>
                          </div>
                        )}
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
