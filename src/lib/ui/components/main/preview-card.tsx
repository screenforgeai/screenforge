import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../utils';

/**
 * Hover previews for settings. Hovering or focusing an option (a toggle, a
 * select item) shows one spacious card beside the panel that plays what the
 * option looks like. One card per provider: moving between options swaps its
 * content in place instead of opening a new popover, so nothing flickers.
 *
 *   const preview = usePreviewCard();
 *   <ToggleGroupItem {...preview.bind('smooth', () => <Card … />)} />
 */

// Timing follows NN/g's hover guidance: wait for intent before the first card,
// then stay open while the pointer moves around the controls. Gaps between rows
// (headings, padding) never close it; leaving for longer than CLOSE_DELAY_MS does.
// Inside an open menu the person has already shown intent, so items preview at once.
const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 450;
const WARM_WINDOW_MS = 400;
const CARD_ID = 'sf-preview-card';
// Until the card has been measured once, assume its usual height.
const ESTIMATED_HEIGHT = 300;

// The card animates only when it appears from nothing (200ms in) or finally
// leaves (120ms out). Moving between options never replays either, so there is
// nothing to flicker. Keyframes live in index.css (.sf-preview-card).
const EXIT_MS = 120;
const CARD_WIDTH = 320;
const GAP = 12;
const EDGE = 8;

type Render = () => React.ReactNode;

interface PreviewCardApi {
  bind: (
    id: string,
    render: Render,
  ) => {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onFocus: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur: () => void;
    'aria-describedby'?: string;
  };
  /**
   * Shows the card at once and keeps it in sync while a control is being
   * changed (a slider drag). Calls are batched to one update per frame, so
   * dragging costs at most one small render per frame.
   */
  present: (id: string, anchor: HTMLElement, render: Render) => void;
  /** Lets a presented card close after the usual grace period. */
  release: () => void;
  hide: () => void;
}

const PreviewCardContext = React.createContext<PreviewCardApi | null>(null);

interface OpenState {
  id: string;
  render: Render;
  anchor: HTMLElement;
}

interface CardState extends OpenState {
  left: number;
  top: number;
  /** Where the card was first placed; later rows are reached by translating from here. */
  baseTop: number;
  phase: 'open' | 'closing';
  /** Plays the enter animation; only when the card appears from nothing. */
  enter: boolean;
  /** Glides to a new row; off for the first placement so it doesn't slide in. */
  glide: boolean;
}

/**
 * Where the card sits: beside the panel (and any open menu), so it never covers
 * a control. Vertically it follows the hovered control, centred on it, but stays
 * within the panel (data-preview-boundary) so it never drifts past it.
 */
function placeCard(anchor: HTMLElement, height: number) {
  const listbox = anchor.closest<HTMLElement>('[role="listbox"]');
  const panel =
    anchor.closest<HTMLElement>('[data-preview-boundary]') ??
    document.querySelector<HTMLElement>('[data-preview-boundary]');
  const sides = [listbox, panel, anchor]
    .filter((el): el is HTMLElement => el !== null)
    .map((el) => el.getBoundingClientRect());
  const right = Math.max(...sides.map((r) => r.right));
  const leftEdge = Math.min(...sides.map((r) => r.left));
  let left = right + GAP;
  if (left + CARD_WIDTH > window.innerWidth - EDGE) {
    left = Math.max(EDGE, leftEdge - GAP - CARD_WIDTH);
  }
  const a = anchor.getBoundingClientRect();
  let top = a.top + a.height / 2 - height / 2;
  if (panel) {
    const area = panel.getBoundingClientRect();
    top = Math.max(area.top, Math.min(top, Math.max(area.top, area.bottom - height)));
  }
  top = Math.min(Math.max(EDGE, top), Math.max(EDGE, window.innerHeight - height - EDGE));
  return { left, top };
}

export const PreviewCardProvider = ({ children }: { children: React.ReactNode }) => {
  const [card, setCard] = React.useState<CardState | null>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const heightRef = React.useRef(ESTIMATED_HEIGHT);
  const exitTimer = React.useRef<number | null>(null);
  const openTimer = React.useRef<number | null>(null);
  const closeTimer = React.useRef<number | null>(null);
  const lastClosedAt = React.useRef(0);
  const isOpen = React.useRef(false);
  const pending = React.useRef<OpenState | null>(null);
  const presentFrame = React.useRef<number | null>(null);

  const clearTimers = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const cardAnchor = React.useRef<HTMLElement | null>(null);

  const close = React.useCallback(() => {
    clearTimers();
    if (isOpen.current) {
      lastClosedAt.current = performance.now();
    }
    isOpen.current = false;
    setCard((current) => (current ? { ...current, phase: 'closing' } : null));
    if (exitTimer.current !== null) {
      window.clearTimeout(exitTimer.current);
    }
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null;
      setCard((current) => (current?.phase === 'closing' ? null : current));
    }, EXIT_MS);
  }, []);

  /**
   * Shows `next`. A card that is already up (or still on its way out) keeps its
   * place and just swaps content, with no animation; only a card appearing from
   * nothing is placed and animates in.
   */
  const commit = React.useCallback((next: OpenState) => {
    isOpen.current = true;
    cardAnchor.current = next.anchor;
    if (exitTimer.current !== null) {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    setCard((current) => {
      const placed = placeCard(next.anchor, heightRef.current);
      return current
        ? {
            ...current,
            ...next,
            top: placed.top,
            phase: 'open',
            enter: current.phase === 'open' && current.enter,
            glide: true,
          }
        : { ...next, ...placed, baseTop: placed.top, phase: 'open', enter: true, glide: false };
    });
  }, []);

  const show = React.useCallback(
    (next: OpenState) => {
      clearTimers();
      const warm =
        isOpen.current ||
        performance.now() - lastClosedAt.current < WARM_WINDOW_MS ||
        next.anchor.closest('[role="listbox"]') !== null;
      if (warm) {
        commit(next);
      } else {
        openTimer.current = window.setTimeout(() => commit(next), OPEN_DELAY_MS);
      }
    },
    [commit],
  );

  const scheduleClose = React.useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
    }
    // A menu moves focus between its items as the pointer moves, which looks like
    // leaving. While the menu the card belongs to is still open, keep the card up.
    const closeUnlessMenuOpen = () => {
      const menu = cardAnchor.current?.closest('[role="listbox"]');
      if (menu?.isConnected) {
        closeTimer.current = window.setTimeout(closeUnlessMenuOpen, CLOSE_DELAY_MS);
        return;
      }
      close();
    };
    closeTimer.current = window.setTimeout(closeUnlessMenuOpen, CLOSE_DELAY_MS);
  }, [close]);

  const present = React.useCallback(
    (id: string, anchor: HTMLElement, render: Render) => {
      clearTimers();
      pending.current = { id, anchor, render };
      if (presentFrame.current !== null) {
        return;
      }
      presentFrame.current = requestAnimationFrame(() => {
        presentFrame.current = null;
        if (pending.current) {
          commit(pending.current);
        }
      });
    },
    [commit],
  );

  // Re-centre when the card's real height is known or changes (descriptions wrap
  // differently per option). The first placement snaps; after that it glides.
  React.useLayoutEffect(() => {
    const height = cardRef.current?.offsetHeight;
    if (!card || !height || height === heightRef.current) {
      return;
    }
    heightRef.current = height;
    const placed = placeCard(card.anchor, height);
    if (placed.top === card.top && placed.left === card.left) {
      return;
    }
    setCard(
      card.glide
        ? { ...card, top: placed.top }
        : { ...card, ...placed, baseTop: placed.top, glide: false },
    );
  }, [card]);

  const isShowing = card?.phase === 'open';
  React.useEffect(() => {
    if (!isShowing) {
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // Scrolling the page moves controls out from under the card, so it closes; a
    // long menu scrolling its own list doesn't (the next hovered item re-places it).
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Element && e.target.closest('[role="listbox"]'))) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [isShowing, close]);

  React.useEffect(
    () => () => {
      clearTimers();
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
      }
      if (presentFrame.current !== null) {
        cancelAnimationFrame(presentFrame.current);
      }
    },
    [],
  );

  const openId = isShowing ? card.id : null;
  const api = React.useMemo<PreviewCardApi>(
    () => ({
      bind: (id, render) => ({
        onPointerEnter: (e) => {
          if (e.pointerType === 'mouse') {
            show({ id, render, anchor: e.currentTarget });
          }
        },
        onPointerLeave: scheduleClose,
        onFocus: (e) => {
          if (
            e.currentTarget.matches(':focus-visible') ||
            e.currentTarget.closest('[role="listbox"]')
          ) {
            show({ id, render, anchor: e.currentTarget });
          }
        },
        onBlur: scheduleClose,
        'aria-describedby': openId === id ? CARD_ID : undefined,
      }),
      present,
      release: scheduleClose,
      hide: close,
    }),
    [show, present, scheduleClose, close, openId],
  );

  const keepOpen = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  return (
    <PreviewCardContext.Provider value={api}>
      {children}
      {createPortal(
        card && (
          <div
            ref={cardRef}
            id={CARD_ID}
            role="tooltip"
            data-state={card.phase === 'open' ? 'open' : 'closed'}
            data-enter={card.enter ? 'true' : 'false'}
            data-glide={card.glide ? 'true' : 'false'}
            onPointerEnter={keepOpen}
            onPointerLeave={scheduleClose}
            className={cn(
              'sf-preview-card fixed z-50 overflow-hidden rounded-xl border border-sf-border bg-sf-panel/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_1px_rgba(0,0,0,0.2),0_18px_44px_rgba(0,0,0,0.45)] backdrop-blur-xl',
              card.phase !== 'open' && 'pointer-events-none',
            )}
            style={{
              width: CARD_WIDTH,
              left: card.left,
              top: card.baseTop,
              // Moving between rows uses `translate` (GPU-composited, separate from the
              // enter/exit `transform`), so the glide is smooth and never re-lays out.
              translate: `0 ${card.top - card.baseTop}px`,
            }}
          >
            {/* Not keyed by option: the preview keeps running and just takes the new option. */}
            {card.render()}
          </div>
        ),
        document.body,
      )}
    </PreviewCardContext.Provider>
  );
};

export function usePreviewCard(): PreviewCardApi {
  const api = React.useContext(PreviewCardContext);
  if (!api) {
    throw new Error('usePreviewCard must be used inside PreviewCardProvider');
  }
  return api;
}

/**
 * Standard card body: a full-bleed live preview on top, then the option's name
 * and what it does. Every preview in the app uses this so they read as one family.
 */
export const PreviewCardBody = ({
  preview,
  title,
  description,
  badge,
  className,
}: {
  preview: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  className?: string;
}) => (
  <div className={cn('flex flex-col', className)}>
    {preview}
    <div className="flex flex-col gap-1 px-3.5 pb-3.5 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-md font-medium text-sf-primary">{title}</span>
        {badge && (
          <span className="rounded-full border border-sf-border-lt/70 bg-sf-border-lt/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sf-primary">
            {badge}
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed text-sf-secondary">{description}</p>
    </div>
  </div>
);
