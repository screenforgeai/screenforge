import { useState, useEffect, useEffectEvent, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { IconX, IconPlayerPlayFilled, IconPlayerPauseFilled, IconRestart } from 'src/lib/icons';
import { Button } from 'src/lib/ui';

// ─── Persistence keys ─────────────────────────────────────────────────────────
const KEY_SCRIPT = 'tp:script';
const KEY_FONT_SIZE = 'tp:font-size';
const KEY_SPEED = 'tp:speed';

// ─── Constants ────────────────────────────────────────────────────────────────
const FONT_SIZE_MIN = 16;
const FONT_SIZE_MAX = 52;
const FONT_SIZE_STEP = 4;
const SPEED_MIN = 5;
const SPEED_MAX = 220;

// Applied to interactive elements that live inside a WebkitAppRegion:drag surface
const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

// ─── Sub-components ───────────────────────────────────────────────────────────

const DragStrip = ({ children }: { children?: React.ReactNode }) => (
  <div
    className="flex h-9 shrink-0 items-center gap-2 px-3"
    style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
  >
    {children}
  </div>
);

const CloseBtn = ({ onClick }: { onClick: () => void }) => {
  const { t } = useTranslation('common');
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-label={t('tp_close')}
      style={NO_DRAG}
      className="cursor-pointer h-6 w-6 rounded-md"
    >
      <IconX size={13} />
    </Button>
  );
};

const FontSizeControl = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => {
  const { t } = useTranslation('common');
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        aria-label={t('tp_decreaseFont')}
        disabled={value <= FONT_SIZE_MIN}
        onClick={() => onChange(Math.max(FONT_SIZE_MIN, value - FONT_SIZE_STEP))}
        className="h-6 w-6 rounded-md"
      >
        A-
      </Button>
      <Button
        variant="ghost"
        type="button"
        aria-label={t('tp_increaseFont')}
        disabled={value >= FONT_SIZE_MAX}
        onClick={() => onChange(Math.min(FONT_SIZE_MAX, value + FONT_SIZE_STEP))}
        className="h-6 w-6 rounded-md"
      >
        A+
      </Button>
    </div>
  );
};

// ─── Edit Mode ────────────────────────────────────────────────────────────────

type EditModeProps = {
  script: string;
  onScriptChange: (v: string) => void;
  onStart: () => void;
};

const EditMode = ({ script, onScriptChange, onStart }: EditModeProps) => {
  const { t } = useTranslation('common');
  const chars = script.length;

  return (
    <motion.div
      key="edit"
      className="flex h-full flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {/* Title bar */}
      <DragStrip>
        <span className="flex-1 text-sm tracking-widest text-sf-primary">{t('tp_title')}</span>
        {chars > 0 && (
          <span className="text-sm tabular-nums text-sf-primary" style={NO_DRAG}>
            {chars}
          </span>
        )}
        <CloseBtn onClick={() => window.screenforge.closeTeleprompter()} />
      </DragStrip>

      {/* Divider */}
      <div className="h-px shrink-0 bg-sf-border" />

      {/* Script textarea */}
      <textarea
        value={script}
        onChange={(e) => onScriptChange(e.target.value)}
        placeholder={t('tp_placeholder')}
        spellCheck
        className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-sf-primary/80 placeholder:text-sf-muted focus:outline-none"
        style={{ fontSize: 14, lineHeight: 1.65 }}
        autoFocus
      />

      {/* Divider */}
      <div className="h-px shrink-0 bg-sf-border" />

      {/* Footer */}
      <div className="flex h-11 shrink-0 items-center justify-between px-3">
        <span className="text-2xs text-sf-muted/80">{t('tp_hint')}</span>
        <Button
          type="button"
          size="sm"
          disabled={!script.trim()}
          onClick={onStart}
          className="cursor-pointer"
        >
          <IconPlayerPlayFilled size={14} />
          {t('tp_start')}
        </Button>
      </div>
    </motion.div>
  );
};

// ─── Play Mode ────────────────────────────────────────────────────────────────

type PlayModeProps = {
  script: string;
  fontSize: number;
  speed: number;
  isPlaying: boolean;
  isDone: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onTogglePlay: () => void;
  onRestart: () => void;
  onFontSizeChange: (v: number) => void;
  onSpeedChange: (v: number) => void;
  onBack: () => void;
};

const PlayMode = ({
  script,
  fontSize,
  speed,
  isPlaying,
  isDone,
  scrollRef,
  onTogglePlay,
  onRestart,
  onFontSizeChange,
  onSpeedChange,
  onBack,
}: PlayModeProps) => {
  const { t } = useTranslation('common');
  return (
    <motion.div
      key="play"
      className="relative flex h-full flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      {/* ── Row 1: session controls ─────────────────────────────────────────── */}
      <DragStrip>
        {/* Left — back to edit */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label={t('tp_backToEdit')}
          style={NO_DRAG}
          className="h-6"
        >
          {t('tp_edit')}
        </Button>

        {/* Center — drag zone fills the gap */}
        <div className="flex-1" />

        {/* Right — restart + play/pause + close */}
        <div className="flex items-center gap-1" style={NO_DRAG}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRestart}
            aria-label={t('tp_restart')}
            className="h-6 w-6"
          >
            <IconRestart />
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onTogglePlay}
            aria-label={isPlaying ? t('tp_pause') : t('tp_resume')}
            className="h-6 w-6"
          >
            {isPlaying ? <IconPlayerPauseFilled size={14} /> : <IconPlayerPlayFilled size={14} />}
          </Button>
          <div className="mx-0.5 h-3.5 w-px shrink-0 bg-sf-border" />
          <CloseBtn onClick={() => window.screenforge.closeTeleprompter()} />
        </div>
      </DragStrip>

      <div className="h-px shrink-0 bg-sf-border" />

      {/* Scroll container — click to pause/resume */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Top fade */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10"
          style={{
            background: 'linear-gradient(to bottom, rgba(11,11,13,0.95) 0%, transparent 100%)',
          }}
        />

        <div
          ref={scrollRef}
          onClick={onTogglePlay}
          className="h-full overflow-y-auto scrollbar-none px-5 py-6"
          style={{ scrollbarWidth: 'none' }}
        >
          <p
            className="select-none whitespace-pre-wrap leading-relaxed text-sf-primary/80"
            style={{ fontSize, lineHeight: 1.7 }}
          >
            {script}
          </p>
          {/* Bottom padding so the last line scrolls to the visible center */}
          <div style={{ height: '60%' }} />
        </div>

        {/* Bottom fade */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10"
          style={{
            background: 'linear-gradient(to top, rgba(11,11,13,0.95) 0%, transparent 100%)',
          }}
        />

        {/* Paused badge */}
        <AnimatePresence>
          {!isPlaying && !isDone && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className=" pointer-events-none absolute inset-x-0 top-30 z-10 flex justify-center"
            >
              <span className=" rounded-full border border-sf-border bg-sf-panel px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-sf-secondary">
                {t('tp_paused')}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Bottom: typographic + speed controls ───────────────────────────── */}
      <div className="h-px shrink-0 bg-sf-border" />
      <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        <FontSizeControl value={fontSize} onChange={onFontSizeChange} />
        <div className="h-3.5 w-px shrink-0 bg-sf-border" />
        <span className="shrink-0 text-xs font-medium tracking-[0.08em] text-sf-muted">
          {t('tp_speed')}
        </span>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={5}
          value={speed}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          aria-label={t('tp_scrollSpeed')}
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-sf-border accent-primary outline-none"
        />
      </div>
    </motion.div>
  );
};

// ─── Root component ───────────────────────────────────────────────────────────

type Mode = 'edit' | 'play';

export const Teleprompter = () => {
  const [mode, setMode] = useState<Mode>('edit');
  const [script, setScript] = useState(() => localStorage.getItem(KEY_SCRIPT) ?? '');
  const [fontSize, setFontSize] = useState(() => Number(localStorage.getItem(KEY_FONT_SIZE)) || 24);
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem(KEY_SPEED)) || 80);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isDone, setIsDone] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const scrollPosRef = useRef(0);

  // Persist settings
  useEffect(() => {
    localStorage.setItem(KEY_SCRIPT, script);
  }, [script]);

  // When the scene overlay navigates to a new scene it writes the new script to localStorage.
  // Always update the script content; only restart playback if already in play mode.
  const applyExternalScript = useEffectEvent((newScript: string) => {
    setScript(newScript);
    scrollPosRef.current = 0;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    lastTsRef.current = null;
    setIsDone(false);
    if (mode === 'play') {
      setIsPlaying(true);
    }
  });

  // When recording actually starts, restart teleprompter from the top and begin playing.
  const restartForRecording = useEffectEvent(() => {
    scrollPosRef.current = 0;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    lastTsRef.current = null;
    setIsDone(false);
    if (mode === 'play') {
      setIsPlaying(true);
    }
  });

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === KEY_SCRIPT) {
        if (e.newValue !== null && e.newValue !== e.oldValue) {
          applyExternalScript(e.newValue);
        }
        return;
      }
      if (e.key === 'sf:recording-start') {
        restartForRecording();
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  useEffect(() => {
    localStorage.setItem(KEY_FONT_SIZE, String(fontSize));
  }, [fontSize]);
  useEffect(() => {
    localStorage.setItem(KEY_SPEED, String(speed));
  }, [speed]);

  const startPlay = useCallback(() => {
    scrollPosRef.current = 0;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    setIsDone(false);
    setIsPlaying(true);
    setMode('play');
  }, []);

  const handleRestart = useCallback(() => {
    scrollPosRef.current = 0;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    lastTsRef.current = null;
    setIsDone(false);
    setIsPlaying(true);
  }, []);

  // Auto-scroll RAF loop
  useEffect(() => {
    const shouldRun = mode === 'play' && isPlaying && !isDone;

    if (!shouldRun) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTsRef.current = null;
      return;
    }

    const tick = (ts: number) => {
      if (lastTsRef.current === null) {
        lastTsRef.current = ts;
      }
      const delta = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      const el = scrollRef.current;
      if (!el) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      scrollPosRef.current += speed * delta;
      const max = el.scrollHeight - el.clientHeight;

      if (scrollPosRef.current >= max) {
        scrollPosRef.current = max;
        el.scrollTop = max;
        setIsDone(true);
        return;
      }

      el.scrollTop = scrollPosRef.current;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [mode, isPlaying, isDone, speed]);

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((p) => {
      if (p) {
        lastTsRef.current = null;
      }
      return !p;
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (mode !== 'play') {
      return;
    }

    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      }
      if (e.code === 'Escape') {
        setMode('edit');
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mode, handleTogglePlay]);

  return (
    <div className="h-screen w-screen overflow-hidden" style={{ background: 'transparent' }}>
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-xl"
        style={{
          background: 'rgba(11, 11, 13, 0.94)',
          border: '1px solid rgba(50, 50, 58, 0.9)',
          boxShadow: '0 0 0 0.5px rgba(255,255,255,0.04) inset, 0 24px 48px rgba(0,0,0,0.7)',
        }}
      >
        <AnimatePresence mode="wait">
          {mode === 'edit' ? (
            <EditMode key="edit" script={script} onScriptChange={setScript} onStart={startPlay} />
          ) : (
            <PlayMode
              key="play"
              script={script}
              fontSize={fontSize}
              speed={speed}
              isPlaying={isPlaying}
              isDone={isDone}
              scrollRef={scrollRef}
              onTogglePlay={handleTogglePlay}
              onRestart={handleRestart}
              onFontSizeChange={setFontSize}
              onSpeedChange={setSpeed}
              onBack={() => setMode('edit')}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
