import { useState, useCallback, useEffect, useEffectEvent, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { IconCheck, IconScript } from 'src/lib/icons';
import { cn } from 'src/lib/utils';
import type { Scene } from 'src/store';

export const OVERLAY_SCENES_KEY = 'sf:overlay-scenes';
const TP_SCRIPT_KEY = 'tp:script';

const SPRING = { type: 'spring', stiffness: 360, damping: 30, mass: 0.85 } as const;
const SLIDE = { duration: 0.18, ease: [0.16, 1, 0.3, 1] } as const;

// ─── Inline SVG primitives ────────────────────────────────────────────────────

const ChevronDown = ({ className }: { className?: string }) => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 11 11"
    fill="none"
    aria-hidden="true"
    className={className}
  >
    <path
      d="M2 3.5L5.5 7L9 3.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ArrowLeft = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d="M7.5 2.5L4 6L7.5 9.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ArrowRight = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path
      d="M4.5 2.5L8 6L4.5 9.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const LiveDot = () => (
  <span className="relative flex h-[7px] w-[7px] shrink-0">
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#e54d4d] opacity-40" />
    <span className="relative inline-flex h-[7px] w-[7px] rounded-full bg-[#e54d4d]" />
  </span>
);

// ─── Scenes state ─────────────────────────────────────────────────────────────

function readScenes(): Scene[] {
  try {
    const raw = localStorage.getItem(OVERLAY_SCENES_KEY);
    return raw ? (JSON.parse(raw) as Scene[]) : [];
  } catch {
    return [];
  }
}

// ─── Window component ─────────────────────────────────────────────────────────

export const SceneOverlayWindow = () => {
  const { t } = useTranslation('recordings');
  const [scenes, setScenes] = useState<Scene[]>(() => readScenes());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [slideDir, setSlideDir] = useState<1 | -1>(1);
  const [teleprompterOpen, setTeleprompterOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Sync scenes if the main window writes updated data
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === OVERLAY_SCENES_KEY) {
        setScenes(readScenes());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // Track teleprompter state
  useEffect(() => {
    const unsubReady = window.screenforge.onTeleprompterReady(() => setTeleprompterOpen(true));
    const unsubClosed = window.screenforge.onTeleprompterClosed(() => setTeleprompterOpen(false));
    return () => {
      unsubReady();
      unsubClosed();
    };
  }, []);

  // Resize the native window to match content height
  useEffect(() => {
    const el = cardRef.current;
    if (!el) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      const h = Math.ceil(entry.contentRect.height) + 8; // 8px top padding in container
      void window.screenforge.resizeSceneOverlay(h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const sorted = useMemo(() => [...scenes].sort((a, b) => a.order - b.order), [scenes]);
  const scene = sorted[currentIndex] ?? null;
  const isRecorded = scene?.status === 'recorded' || scene?.status === 'done';

  const goNext = useCallback(() => {
    setSlideDir(1);
    setCurrentIndex((i) => Math.min(i + 1, sorted.length - 1));
  }, [sorted.length]);

  const goPrev = useCallback(() => {
    setSlideDir(-1);
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Marks current scene as recorded then advances — always sees latest scene/isRecorded
  const goNextWithMark = useEffectEvent(() => {
    if (scene && !isRecorded) {
      const status: Scene['status'] = 'recorded';
      setScenes((prev) => prev.map((s) => (s.id === scene.id ? { ...s, status } : s)));
      window.screenforge.updateSceneFromOverlay({ id: scene.id, patch: { status } });
    }
    setSlideDir(1);
    setCurrentIndex((i) => Math.min(i + 1, sorted.length - 1));
  });

  // Wire up global [ / ] keyboard shortcuts from main process
  useEffect(() => {
    const unsubNext = window.screenforge.onSceneNextRequested(goNextWithMark);
    const unsubPrev = window.screenforge.onScenePrevRequested(goPrev);
    return () => {
      unsubNext();
      unsubPrev();
    };
  }, [goPrev]);

  // Reads latest teleprompterOpen without being a reactive dep of the index effect
  const syncScriptAndOpenTeleprompter = useEffectEvent((script: string) => {
    localStorage.setItem(TP_SCRIPT_KEY, script);
    if (!teleprompterOpen) {
      window.screenforge.openTeleprompterBelowOverlay();
    }
  });

  // Sync script (and clear it) when navigating between scenes
  useEffect(() => {
    const script = sorted[currentIndex]?.script;
    if (script) {
      syncScriptAndOpenTeleprompter(script);
    } else {
      // Clear teleprompter text when the scene has no script
      localStorage.setItem(TP_SCRIPT_KEY, '');
    }
  }, [currentIndex, sorted]);

  const handleMarkRecorded = useCallback(() => {
    if (!scene) {
      return;
    }
    const nextStatus = isRecorded ? 'planned' : 'recorded';
    setScenes((prev) =>
      prev.map((s) => (s.id === scene.id ? { ...s, status: nextStatus as Scene['status'] } : s)),
    );
    window.screenforge.updateSceneFromOverlay({ id: scene.id, patch: { status: nextStatus } });
    // Auto-advance to next scene when marking done
    if (!isRecorded) {
      setSlideDir(1);
      setCurrentIndex((i) => Math.min(i + 1, sorted.length - 1));
    }
  }, [scene, isRecorded, sorted.length]);

  const handleOpenScript = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!scene?.script) {
        return;
      }
      localStorage.setItem(TP_SCRIPT_KEY, scene.script);
      window.screenforge.openTeleprompterBelowOverlay();
      setTeleprompterOpen(true);
    },
    [scene],
  );

  if (sorted.length === 0) {
    return null;
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent p-[4px]">
      <div ref={cardRef}>
        <div
          className="overflow-hidden rounded-xl"
          style={{
            background: 'rgba(11, 11, 13, 0.94)',
            border: '1px solid rgba(50, 50, 58, 0.88)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 48px rgba(0,0,0,0.65)',
          }}
        >
          {/* ── Header — drag zone covers the full row ──────────────── */}
          <div
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <LiveDot />

            <span className="shrink-0 font-mono text-[10px] tabular-nums tracking-wider text-sf-muted">
              {String(currentIndex + 1).padStart(2, '0')}
              <span className="mx-0.5 opacity-30">/</span>
              {String(sorted.length).padStart(2, '0')}
            </span>

            <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-snug text-sf-primary">
              {scene?.title ?? '—'}
            </span>

            {isRecorded && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-emerald-400">
                <IconCheck size={8} stroke={2.5} />
                {t('scenes_done')}
              </span>
            )}

            {/* Collapse toggle — must be no-drag so click registers */}
            <button
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? t('scenes_expand') : t('scenes_collapse')}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-sf-muted/50 transition-colors duration-150 hover:bg-white/[0.06] hover:text-sf-muted active:scale-95"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <ChevronDown
                className={cn('transition-transform duration-200', collapsed ? '' : 'rotate-180')}
              />
            </button>
          </div>

          {/* ── Expandable body ──────────────────────────────────────── */}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                key="body"
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                transition={SPRING}
                style={{ overflow: 'hidden' }}
              >
                <div className="h-px bg-white/[0.06]" />

                <div className="relative overflow-hidden">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={currentIndex}
                      initial={{ x: slideDir * 16, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      exit={{ x: slideDir * -16, opacity: 0 }}
                      transition={SLIDE}
                      className="px-3.5 pt-3 pb-2.5"
                    >
                      {scene?.context ? (
                        <p className="line-clamp-2 text-[12px] leading-relaxed text-sf-secondary">
                          {scene.context}
                        </p>
                      ) : (
                        <p className="text-[12px] italic text-sf-muted/40">
                          {t('scenes_noDescription')}
                        </p>
                      )}

                      {scene?.notes && (
                        <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-sf-muted/60 italic">
                          {scene.notes}
                        </p>
                      )}

                      <div className="mt-2.5 flex items-center gap-2">
                        {scene?.script && (
                          <button
                            onClick={handleOpenScript}
                            className={cn(
                              'flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-[3px] text-[11px] font-medium transition-colors duration-150 active:scale-[0.97]',
                              teleprompterOpen
                                ? 'border-primary/30 bg-primary/10 text-primary'
                                : 'border-sf-border text-sf-secondary hover:border-sf-border-lt hover:text-sf-primary',
                            )}
                          >
                            <IconScript size={11} />
                            {teleprompterOpen ? t('scenes_scriptOpen') : t('scenes_openScript')}
                          </button>
                        )}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* ── Footer ────────────────────────────────────────── */}
                <div
                  className="flex items-center justify-between border-t border-white/[0.06] px-2 py-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    disabled={currentIndex === 0}
                    onClick={goPrev}
                    aria-label={t('scenes_prevScene')}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-sf-secondary transition-colors duration-150 hover:bg-white/[0.05] hover:text-sf-primary active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    <ArrowLeft />
                  </button>

                  <button
                    onClick={handleMarkRecorded}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1 text-[11px] font-medium transition-all duration-150 active:scale-[0.96]',
                      isRecorded
                        ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20'
                        : 'text-sf-muted hover:bg-white/[0.05] hover:text-sf-primary',
                    )}
                  >
                    <IconCheck size={11} stroke={isRecorded ? 2.5 : 1.5} />
                    {isRecorded ? t('scenes_recorded') : t('scenes_markDone')}
                  </button>

                  <button
                    disabled={currentIndex === sorted.length - 1}
                    onClick={goNext}
                    aria-label={t('scenes_nextScene')}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-sf-secondary transition-colors duration-150 hover:bg-white/[0.05] hover:text-sf-primary active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-25"
                  >
                    <ArrowRight />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
