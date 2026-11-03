import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from 'src/store';
import type { TextClip } from 'src/store';
import { trackEvent } from 'src/lib/analytics';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  ToggleGroup,
  ToggleGroupItem,
} from 'src/lib/ui';
import {
  IconText,
  IconPlus,
  IconX,
  IconTextBold,
  IconTextItalic,
  IconTextUnderline,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconAlignTop,
  IconAlignMiddle,
  IconAlignBottom,
} from 'src/lib/icons';
import {
  WIDGET_EMPTY_STATE_CLASS,
  WIDGET_EMPTY_TITLE_CLASS,
  WIDGET_PANEL_HEADER_CLASS,
  WIDGET_SECTION_HEADING_CLASS,
} from 'src/components/layout';
import { cn, formatTime } from 'src/lib/utils';

const CURATED_FONTS = [
  'SF Pro Display',
  'Helvetica Neue',
  'Instrument Sans',
  'Inter',
  'Geist',
  'Georgia',
  'Playfair Display',
  'JetBrains Mono',
  'Impact',
  'Arial Black',
  'Trebuchet MS',
  'Courier New',
] as const;

const ANIMATION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide-up', label: 'Slide Up' },
  { value: 'slide-down', label: 'Slide Down' },
] as const;

function defaultTextClip(id: string, start: number): TextClip {
  return {
    id,
    start,
    end: start + 4,
    content: 'Text',
    x: 0.3,
    y: 0.4,
    width: 0.4,
    height: 0.1,
    fontFamily: 'Instrument Sans',
    fontSize: 48,
    bold: false,
    italic: false,
    underline: false,

    align: 'center',
    verticalAlign: 'top',
    color: '#F4F0EE',
    colorOpacity: 100,
    backgroundEnabled: true,
    backgroundColor: '#000000',
    backgroundOpacity: 78,
    backgroundRadius: 6,
    backgroundPadding: 10,
    animationIn: 'fade',
    animationInDuration: 0.3,
    animationOut: 'fade',
    animationOutDuration: 0.3,
  };
}

const LiveBadge = () => (
  <span className="rounded-full border border-sf-border-lt/70 bg-sf-border-lt/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-primary">
    LIVE
  </span>
);

const ColorSwatch = ({ color, onChange }: { color: string; onChange: (v: string) => void }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="size-7 shrink-0 rounded border border-sf-border transition-[border-color] hover:border-sf-border-lt"
        style={{ backgroundColor: color }}
        onClick={() => ref.current?.click()}
        aria-label="Pick color"
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

const TextClipCard = ({
  clip,
  isExpanded,
  isActive,
  onToggleExpand,
  onDelete,
  onUpdate,
  onBeginHistory,
  onEndHistory,
}: {
  clip: TextClip;
  isExpanded: boolean;
  isActive: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  onUpdate: (patch: Partial<TextClip>) => void;
  onBeginHistory: (key: string, label: string) => void;
  onEndHistory: (key: string) => void;
}) => {
  const { t } = useTranslation('text');
  const label = clip.content.slice(0, 25) + (clip.content.length > 25 ? '…' : '');
  const isHighlighted = isExpanded || isActive;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-sf-panel transition-[border-color,box-shadow,background-color]',
        isHighlighted
          ? 'border-sf-border-lt bg-[#151519] shadow-[0_0_0_1px_var(--color-sf-border-lt),0_10px_24px_rgba(0,0,0,0.18)]'
          : 'border-sf-border hover:border-sf-border-lt',
      )}
    >
      {/* Header */}
      <div className="group flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-0.5 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-sf-border-lt"
          aria-expanded={isExpanded}
          onClick={onToggleExpand}
        >
          <IconText size={13} className="shrink-0 text-sf-muted" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'truncate text-sm font-medium',
                  isHighlighted ? 'text-sf-primary' : 'text-sf-secondary',
                )}
              >
                {label || t('text')}
              </span>
              {isActive && !isExpanded && <LiveBadge />}
            </div>
            <div
              className={cn(
                'mt-0.5 font-mono text-xs text-sf-secondary',
                isActive && 'text-sf-primary/85',
              )}
            >
              {formatTime(clip.start)} → {formatTime(clip.end)}
            </div>
          </div>
        </button>

        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Delete text clip"
          className={cn(
            'transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
            isHighlighted ? 'opacity-100' : 'opacity-0',
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
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
            <div className="border-t border-sf-border px-3 py-4 flex flex-col gap-5">
              {/* Content */}
              <textarea
                value={clip.content}
                rows={2}
                onChange={(e) => {
                  onUpdate({ content: e.target.value });
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = `${el.scrollHeight}px`;
                }}
                className="w-full resize-none rounded-md border border-sf-border bg-sf-bg px-2.5 py-2 text-sm leading-relaxed text-sf-primary outline-none transition-[border-color] focus:border-sf-border-lt"
                placeholder="Enter text…"
              />

              {/* Font */}
              <div className="flex flex-col gap-3">
                <div className={WIDGET_SECTION_HEADING_CLASS}>{t('font')}</div>
                <Select value={clip.fontFamily} onValueChange={(v) => onUpdate({ fontFamily: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURATED_FONTS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Slider
                  min={8}
                  max={200}
                  step={1}
                  inlineLabel={t('size')}
                  valueLabel={`${clip.fontSize}px`}
                  value={[clip.fontSize]}
                  onPointerDown={() =>
                    onBeginHistory(`text-fontsize-${clip.id}`, 'Adjust font size')
                  }
                  onValueChange={([v]) => onUpdate({ fontSize: v })}
                  onValueCommit={() => onEndHistory(`text-fontsize-${clip.id}`)}
                />
              </div>

              {/* Format */}
              <div className="flex flex-col gap-3">
                <div className={WIDGET_SECTION_HEADING_CLASS}>{t('format')}</div>
                <div className="flex items-center gap-1.5">
                  <ToggleGroup
                    type="multiple"
                    size="sm"
                    value={[
                      clip.bold ? 'bold' : '',
                      clip.italic ? 'italic' : '',
                      clip.underline ? 'underline' : '',
                    ].filter(Boolean)}
                    onValueChange={(vals) =>
                      onUpdate({
                        bold: vals.includes('bold'),
                        italic: vals.includes('italic'),
                        underline: vals.includes('underline'),
                      })
                    }
                  >
                    <ToggleGroupItem value="bold" aria-label="Bold" className="size-7">
                      <IconTextBold size={14} />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="italic" aria-label="Italic" className="size-7">
                      <IconTextItalic size={14} />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="underline" aria-label="Underline" className="size-7">
                      <IconTextUnderline size={14} />
                    </ToggleGroupItem>
                  </ToggleGroup>

                  <div className="mx-1 h-4 w-px bg-sf-border" />

                  <ToggleGroup
                    type="single"
                    size="sm"
                    value={clip.align}
                    onValueChange={(v) => v && onUpdate({ align: v as TextClip['align'] })}
                  >
                    <ToggleGroupItem value="left" aria-label="Align left" className="size-7">
                      <IconAlignLeft size={14} />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="center" aria-label="Align center" className="size-7">
                      <IconAlignCenter size={14} />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="right" aria-label="Align right" className="size-7">
                      <IconAlignRight size={14} />
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <div className="flex items-center justify-between">
                  <ToggleGroup
                    type="single"
                    size="sm"
                    value={clip.verticalAlign ?? 'top'}
                    onValueChange={(v) =>
                      v && onUpdate({ verticalAlign: v as TextClip['verticalAlign'] })
                    }
                  >
                    <ToggleGroupItem value="top" aria-label="Align top" className="size-7">
                      <IconAlignTop size={14} />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="middle" aria-label="Align middle" className="size-7">
                      <IconAlignMiddle size={14} />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="bottom" aria-label="Align bottom" className="size-7">
                      <IconAlignBottom size={14} />
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>

                <Slider
                  min={0}
                  max={100}
                  step={1}
                  inlineLabel="Roundness"
                  valueLabel={`${clip.backgroundRadius}px`}
                  value={[clip.backgroundRadius]}
                  onPointerDown={() =>
                    onBeginHistory(`text-bg-radius-${clip.id}`, 'Adjust roundness')
                  }
                  onValueChange={([v]) => onUpdate({ backgroundRadius: v })}
                  onValueCommit={() => onEndHistory(`text-bg-radius-${clip.id}`)}
                />
              </div>

              {/* Text color */}
              <div className="flex flex-col gap-3">
                <div className={WIDGET_SECTION_HEADING_CLASS}>{t('color')}</div>
                <div className="flex items-center gap-2">
                  <ColorSwatch color={clip.color} onChange={(v) => onUpdate({ color: v })} />
                  <Input
                    type="text"
                    value={clip.color.toUpperCase()}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) {
                        onUpdate({ color: v });
                      }
                    }}
                    className="h-8 flex-1 font-mono text-xs"
                  />
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  inlineLabel="Opacity"
                  valueLabel={`${clip.colorOpacity}%`}
                  value={[clip.colorOpacity]}
                  onPointerDown={() =>
                    onBeginHistory(`text-color-opacity-${clip.id}`, 'Adjust text opacity')
                  }
                  onValueChange={([v]) => onUpdate({ colorOpacity: v })}
                  onValueCommit={() => onEndHistory(`text-color-opacity-${clip.id}`)}
                />
              </div>

              {/* Background */}
              <div className="flex flex-col gap-3">
                <div className={WIDGET_SECTION_HEADING_CLASS}>{t('background')}</div>
                <div className="flex items-center gap-2">
                  <ColorSwatch
                    color={clip.backgroundColor}
                    onChange={(v) => onUpdate({ backgroundColor: v })}
                  />
                  <Input
                    type="text"
                    value={clip.backgroundColor.toUpperCase()}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) {
                        onUpdate({ backgroundColor: v });
                      }
                    }}
                    className="h-8 flex-1 font-mono text-xs"
                  />
                </div>
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  inlineLabel="Opacity"
                  valueLabel={`${clip.backgroundOpacity}%`}
                  value={[clip.backgroundOpacity]}
                  onPointerDown={() =>
                    onBeginHistory(`text-bg-opacity-${clip.id}`, 'Adjust background opacity')
                  }
                  onValueChange={([v]) => onUpdate({ backgroundOpacity: v })}
                  onValueCommit={() => onEndHistory(`text-bg-opacity-${clip.id}`)}
                />
              </div>

              {/* Animation */}
              <div className="flex flex-col gap-3">
                <div className={WIDGET_SECTION_HEADING_CLASS}>{t('animations')}</div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-sf-muted">{t('animationIn')}</span>
                  <Select
                    value={clip.animationIn}
                    onValueChange={(v) => onUpdate({ animationIn: v as TextClip['animationIn'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ANIMATION_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {clip.animationIn !== 'none' && (
                    <Slider
                      min={0.05}
                      max={2}
                      step={0.05}
                      inlineLabel={t('duration')}
                      valueLabel={`${clip.animationInDuration.toFixed(2)}s`}
                      value={[clip.animationInDuration]}
                      onPointerDown={() =>
                        onBeginHistory(`text-anim-in-${clip.id}`, 'Adjust animation in duration')
                      }
                      onValueChange={([v]) => onUpdate({ animationInDuration: v })}
                      onValueCommit={() => onEndHistory(`text-anim-in-${clip.id}`)}
                    />
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-sf-muted">{t('animationOut')}</span>
                  <Select
                    value={clip.animationOut}
                    onValueChange={(v) => onUpdate({ animationOut: v as TextClip['animationOut'] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ANIMATION_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {clip.animationOut !== 'none' && (
                    <Slider
                      min={0.05}
                      max={2}
                      step={0.05}
                      inlineLabel={t('duration')}
                      valueLabel={`${clip.animationOutDuration.toFixed(2)}s`}
                      value={[clip.animationOutDuration]}
                      onPointerDown={() =>
                        onBeginHistory(`text-anim-out-${clip.id}`, 'Adjust animation out duration')
                      }
                      onValueChange={([v]) => onUpdate({ animationOutDuration: v })}
                      onValueCommit={() => onEndHistory(`text-anim-out-${clip.id}`)}
                    />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const TextWidget = () => {
  const { t } = useTranslation('text');
  const [localExpandedId, setLocalExpandedId] = useState<string | null>(null);
  const clipRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const {
    recordingResult,
    textClips,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
    currentTime,
    selectedClip,
    setSelectedClip,
    requestPauseAndSeekTo,
    requestSeekTo,
  } = useStore(
    useShallow((s) => ({
      recordingResult: s.recordingResult,
      textClips: s.textClips,
      commitEdit: s.commitEdit,
      beginHistoryGroup: s.beginHistoryGroup,
      endHistoryGroup: s.endHistoryGroup,
      currentTime: s.currentTime,
      selectedClip: s.selectedClip,
      setSelectedClip: s.setSelectedClip,
      requestPauseAndSeekTo: s.requestPauseAndSeekTo,
      requestSeekTo: s.requestSeekTo,
    })),
  );

  const activeClipIds = new Set(
    textClips.filter((c) => currentTime >= c.start && currentTime <= c.end).map((c) => c.id),
  );

  const expandedId = selectedClip?.effectId === 'text' ? selectedClip.id : localExpandedId;
  const setExpandedId = (id: string | null) => setLocalExpandedId(id);

  const activeClipIdsKey = [...activeClipIds].join(',');
  useEffect(() => {
    for (const id of activeClipIds) {
      clipRefs.current[id]?.scrollIntoView({ block: 'nearest' });
      break; // scroll to first active clip only
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClipIdsKey]);

  if (!recordingResult) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className={WIDGET_PANEL_HEADER_CLASS}>
          <IconText className="size-4.5" />
          {t('header')}
        </div>
        <div className={`${WIDGET_EMPTY_STATE_CLASS} flex-1`}>
          <IconText size={34} className="text-sf-muted" />
          <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noRecordingSelected')}</div>
        </div>
      </div>
    );
  }

  const handleAdd = () => {
    const id = `text-${Date.now()}`;
    const clip = defaultTextClip(id, currentTime);
    commitEdit('Add text clip', (state) => ({
      textClips: [...state.textClips, clip].sort((a, b) => a.start - b.start),
    }));
    trackEvent('text_clip_added', { source: 'widget' });
    setExpandedId(id);
    setSelectedClip({ id, effectId: 'text' });
  };

  const handleDelete = (id: string) => {
    commitEdit('Delete text clip', (state) => ({
      textClips: state.textClips.filter((c) => c.id !== id),
      selectedClip: null,
    }));
    if (expandedId === id) {
      setExpandedId(null);
    }
    trackEvent('text_clip_deleted');
  };

  const handleUpdate = (id: string, patch: Partial<TextClip>) => {
    requestPauseAndSeekTo(currentTime);
    commitEdit('Edit text clip', (state) => ({
      textClips: state.textClips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={WIDGET_PANEL_HEADER_CLASS}>
        <IconText className="size-4.5" />
        {t('header')}
      </div>

      <div className="shrink-0 px-3 flex flex-col gap-2">
        <Button
          size="md"
          variant="secondary"
          className="w-full gap-1.5"
          onClick={handleAdd}
          disabled={!recordingResult}
        >
          <IconPlus size={14} />
          {t('addText')}
        </Button>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-6">
        {textClips.length === 0 && (
          <div className={WIDGET_EMPTY_STATE_CLASS}>
            <IconText size={34} className="text-sf-muted" />
            <div className={WIDGET_EMPTY_TITLE_CLASS}>{t('noTextClips')}</div>
          </div>
        )}

        {textClips.map((clip) => (
          <div
            key={clip.id}
            ref={(node) => {
              clipRefs.current[clip.id] = node;
            }}
          >
            <TextClipCard
              clip={clip}
              isExpanded={expandedId === clip.id}
              isActive={activeClipIds.has(clip.id)}
              onToggleExpand={() => {
                const willExpand = expandedId !== clip.id;
                setExpandedId(willExpand ? clip.id : null);
                setSelectedClip(willExpand ? { id: clip.id, effectId: 'text' } : null);
                if (willExpand) {
                  const isPlayheadOverClip =
                    currentTime >= clip.start + 0.5 && currentTime <= clip.end;
                  if (!isPlayheadOverClip) {
                    requestSeekTo((clip.start + clip.end) / 2);
                  }
                }
              }}
              onDelete={() => handleDelete(clip.id)}
              onUpdate={(patch) => handleUpdate(clip.id, patch)}
              onBeginHistory={(key, label) => beginHistoryGroup(key, label)}
              onEndHistory={(key) => endHistoryGroup(key)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
