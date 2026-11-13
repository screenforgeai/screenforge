import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from 'src/lib/ui';
import { IconCamera, IconPlayerRecordFilled, IconRestart } from 'src/lib/icons';
import { nudgeForKey } from 'src/lib/areaNudge';
import { selectionToImageRect } from 'src/lib/recording/waylandPicker';
import type { AreaSelectorPurpose, AreaSelectorStill } from 'src/types';

type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DragMode = 'draw' | 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se';

type DragState = {
  mode: DragMode;
  startX: number;
  startY: number;
  origRect: SelectionRect | null;
} | null;

const MIN_AREA_SIZE = 32;
const HANDLE_HIT = 20;

const OVERLAY_COLOR = 'rgba(0,0,0,0.65)';

function normalizeRect(x1: number, y1: number, x2: number, y2: number): SelectionRect {
  return {
    x: Math.round(Math.min(x1, x2)),
    y: Math.round(Math.min(y1, y2)),
    width: Math.round(Math.abs(x2 - x1)),
    height: Math.round(Math.abs(y2 - y1)),
  };
}

function getDragMode(cx: number, cy: number, rect: SelectionRect | null): DragMode {
  if (!rect || rect.width < MIN_AREA_SIZE || rect.height < MIN_AREA_SIZE) {
    return 'draw';
  }
  const { x, y, width, height } = rect;
  if (Math.abs(cx - x) <= HANDLE_HIT && Math.abs(cy - y) <= HANDLE_HIT) {
    return 'resize-nw';
  }
  if (Math.abs(cx - (x + width)) <= HANDLE_HIT && Math.abs(cy - y) <= HANDLE_HIT) {
    return 'resize-ne';
  }
  if (Math.abs(cx - x) <= HANDLE_HIT && Math.abs(cy - (y + height)) <= HANDLE_HIT) {
    return 'resize-sw';
  }
  if (Math.abs(cx - (x + width)) <= HANDLE_HIT && Math.abs(cy - (y + height)) <= HANDLE_HIT) {
    return 'resize-se';
  }
  if (cx > x && cx < x + width && cy > y && cy < y + height) {
    return 'move';
  }
  return 'draw';
}

function modeToCursor(mode: DragMode): string {
  switch (mode) {
    case 'move':
      return 'move';
    case 'resize-nw':
      return 'nw-resize';
    case 'resize-ne':
      return 'ne-resize';
    case 'resize-sw':
      return 'sw-resize';
    case 'resize-se':
      return 'se-resize';
    default:
      return 'crosshair';
  }
}

type Props = {
  /** Screenshot swaps the record button for the camera shutter. */
  purpose?: AreaSelectorPurpose;
};

export const AreaSelector = ({ purpose = 'record' }: Props) => {
  const isScreenshot = purpose === 'screenshot' || purpose === 'screenshot-still';
  // Wayland: the area is drawn on a still of the screen picked in the share dialog, shown fitted
  // here, and sent back in the still's own pixels.
  const onStill = purpose === 'screenshot-still' || purpose === 'record-still';
  const [still, setStill] = useState<AreaSelectorStill | null>(null);
  useEffect(() => {
    if (!onStill) {
      return;
    }
    let live = true;
    void window.screenforge.getAreaSelectorStill().then((next) => {
      if (live) {
        setStill(next);
      }
    });
    return () => {
      live = false;
    };
  }, [onStill]);

  /** Sends a selection in this window's pixels, or in the still's when drawing on one. */
  const confirm = useCallback(
    (rect: SelectionRect) => {
      if (!onStill) {
        void window.screenforge.confirmAreaSelection(rect);
        return;
      }
      if (!still) {
        return;
      }
      const onImage = selectionToImageRect(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        still,
      );
      if (onImage) {
        void window.screenforge.confirmAreaSelection(onImage);
      }
    },
    [onStill, still],
  );
  const [confirmedRect, setConfirmedRect] = useState<SelectionRect | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [cursor, setCursor] = useState('crosshair');

  const isDrawing = dragState?.mode === 'draw';

  const selection: SelectionRect | null =
    isDrawing && drawCurrent && dragState
      ? normalizeRect(dragState.startX, dragState.startY, drawCurrent.x, drawCurrent.y)
      : confirmedRect;

  const isValidSelection =
    selection !== null && selection.width >= MIN_AREA_SIZE && selection.height >= MIN_AREA_SIZE;

  const showConfirmButtons =
    confirmedRect !== null &&
    confirmedRect.width >= MIN_AREA_SIZE &&
    confirmedRect.height >= MIN_AREA_SIZE &&
    !isDrawing;

  const handleConfirm = useCallback(() => {
    if (
      !confirmedRect ||
      confirmedRect.width < MIN_AREA_SIZE ||
      confirmedRect.height < MIN_AREA_SIZE
    ) {
      return;
    }
    confirm({
      x: confirmedRect.x,
      y: confirmedRect.y,
      width: confirmedRect.width,
      height: confirmedRect.height,
    });
  }, [confirm, confirmedRect]);

  const handleCancel = useCallback(() => {
    window.screenforge.cancelAreaSelection();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
        return;
      }
      if (e.key === 'Enter') {
        if (showConfirmButtons) {
          handleConfirm();
        } else if (isScreenshot && !dragState) {
          // Nothing drawn yet: Enter takes the whole screen.
          confirm({
            x: 0,
            y: 0,
            width: window.innerWidth,
            height: window.innerHeight,
          });
        }
        return;
      }
      if (showConfirmButtons && confirmedRect) {
        const nudged = nudgeForKey(confirmedRect, e.key, e.shiftKey, {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        if (nudged) {
          e.preventDefault();
          setConfirmedRect(nudged);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    confirm,
    confirmedRect,
    dragState,
    handleCancel,
    handleConfirm,
    isScreenshot,
    showConfirmButtons,
  ]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();

    const mode = getDragMode(e.clientX, e.clientY, confirmedRect);
    setCursor(modeToCursor(mode));

    if (mode === 'draw') {
      setDragState({ mode: 'draw', startX: e.clientX, startY: e.clientY, origRect: null });
      setDrawCurrent({ x: e.clientX, y: e.clientY });
      setConfirmedRect(null);
    } else {
      setDragState({ mode, startX: e.clientX, startY: e.clientY, origRect: confirmedRect });
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragState) {
      setCursor(modeToCursor(getDragMode(e.clientX, e.clientY, confirmedRect)));
      return;
    }

    if (dragState.mode === 'draw') {
      setDrawCurrent({ x: e.clientX, y: e.clientY });
      return;
    }

    const orig = dragState.origRect;
    if (!orig) {
      return;
    }

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    if (dragState.mode === 'move') {
      setConfirmedRect({
        x: Math.round(Math.max(0, Math.min(window.innerWidth - orig.width, orig.x + dx))),
        y: Math.round(Math.max(0, Math.min(window.innerHeight - orig.height, orig.y + dy))),
        width: orig.width,
        height: orig.height,
      });
      return;
    }

    const seX = orig.x + orig.width;
    const seY = orig.y + orig.height;

    if (dragState.mode === 'resize-nw') {
      const newW = Math.max(MIN_AREA_SIZE, orig.width - dx);
      const newH = Math.max(MIN_AREA_SIZE, orig.height - dy);
      setConfirmedRect({
        x: Math.round(seX - newW),
        y: Math.round(seY - newH),
        width: Math.round(newW),
        height: Math.round(newH),
      });
    } else if (dragState.mode === 'resize-ne') {
      const newW = Math.max(MIN_AREA_SIZE, orig.width + dx);
      const newH = Math.max(MIN_AREA_SIZE, orig.height - dy);
      setConfirmedRect({
        x: orig.x,
        y: Math.round(seY - newH),
        width: Math.round(newW),
        height: Math.round(newH),
      });
    } else if (dragState.mode === 'resize-sw') {
      const newW = Math.max(MIN_AREA_SIZE, orig.width - dx);
      const newH = Math.max(MIN_AREA_SIZE, orig.height + dy);
      setConfirmedRect({
        x: Math.round(seX - newW),
        y: orig.y,
        width: Math.round(newW),
        height: Math.round(newH),
      });
    } else if (dragState.mode === 'resize-se') {
      setConfirmedRect({
        x: orig.x,
        y: orig.y,
        width: Math.round(Math.max(MIN_AREA_SIZE, orig.width + dx)),
        height: Math.round(Math.max(MIN_AREA_SIZE, orig.height + dy)),
      });
    }
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (!dragState) {
      return;
    }

    if (dragState.mode === 'draw') {
      const rect = normalizeRect(dragState.startX, dragState.startY, e.clientX, e.clientY);
      if (rect.width >= MIN_AREA_SIZE && rect.height >= MIN_AREA_SIZE) {
        setConfirmedRect(rect);
      }
      setDrawCurrent(null);
    }

    setDragState(null);
  };

  // Buttons anchored to the bottom-right corner of the selection
  const btnTop =
    selection && selection.y + selection.height + 56 < window.innerHeight
      ? selection.y + selection.height + 10
      : selection
        ? selection.y - 50
        : 0;
  const btnRight = selection ? window.innerWidth - (selection.x + selection.width) : 0;

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ cursor, userSelect: 'none' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {onStill && still && (
        <img
          src={still.dataUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
        />
      )}
      {/* Four-panel overlay — avoids SVG mask rendering issues in transparent Electron windows */}
      {(!selection || !isValidSelection) && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: OVERLAY_COLOR, zIndex: 1 }}
        />
      )}
      {selection && isValidSelection && (
        <>
          <div
            className="absolute pointer-events-none"
            style={{
              top: 0,
              left: 0,
              right: 0,
              height: selection.y,
              background: OVERLAY_COLOR,
              zIndex: 1,
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              top: selection.y + selection.height,
              left: 0,
              right: 0,
              bottom: 0,
              background: OVERLAY_COLOR,
              zIndex: 1,
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              top: selection.y,
              left: 0,
              width: selection.x,
              height: selection.height,
              background: OVERLAY_COLOR,
              zIndex: 1,
            }}
          />
          <div
            className="absolute pointer-events-none"
            style={{
              top: selection.y,
              left: selection.x + selection.width,
              right: 0,
              height: selection.height,
              background: OVERLAY_COLOR,
              zIndex: 1,
            }}
          />
        </>
      )}

      {/* Selection border */}
      {selection && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
            zIndex: 2,
            boxShadow: '0 0 0 1px rgba(255,255,255,0.2), 0 0 0 2px rgba(161,161,170,0.75)',
            borderRadius: 2,
          }}
        />
      )}

      {/* Corner handles */}
      {selection && isValidSelection && (
        <>
          {[
            { top: selection.y - 4, left: selection.x - 4 },
            { top: selection.y - 4, left: selection.x + selection.width - 8 },
            { top: selection.y + selection.height - 8, left: selection.x - 4 },
            { top: selection.y + selection.height - 8, left: selection.x + selection.width - 8 },
          ].map((pos, i) => (
            <div
              key={i}
              className="absolute pointer-events-none"
              style={{
                ...pos,
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: 'white',
                boxShadow: '0 0 0 1.5px rgba(161,161,170,0.75)',
                zIndex: 3,
              }}
            />
          ))}
        </>
      )}

      {/* Dimension label — inside bottom-right of selection */}
      {selection && isValidSelection && (
        <div
          className="absolute pointer-events-none tabular-nums"
          style={{
            left: selection.x + selection.width - 8,
            top: selection.y + selection.height - 8,
            transform: 'translate(-100%, -100%)',
            zIndex: 4,
            fontSize: 11,
            fontWeight: 500,
            fontFamily: 'ui-monospace, monospace',
            color: 'rgba(255,255,255,0.85)',
            background: 'rgba(0,0,0,0.55)',
            borderRadius: 4,
            padding: '2px 6px',
            letterSpacing: '0.01em',
          }}
        >
          {selection.width} × {selection.height}
        </div>
      )}

      {/* Instruction hint */}
      <AnimatePresence>
        {!isDrawing && !confirmedRect && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute top-6 left-0 right-0 flex justify-center pointer-events-none"
            style={{ zIndex: 10 }}
          >
            <div
              style={{
                background: 'rgba(0,0,0,0.65)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 16px',
                fontSize: 13,
                color: 'rgba(255,255,255,0.75)',
                whiteSpace: 'nowrap',
              }}
            >
              {isScreenshot
                ? 'Drag to select an area · Enter for the whole screen · Esc to cancel'
                : 'Drag to select a recording area · Esc to cancel'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Redraw + Start Recording — right-aligned to bottom-right corner of selection */}
      <AnimatePresence>
        {showConfirmButtons && selection && (
          <motion.div
            key="confirm-btn"
            initial={{ opacity: 0, scale: 0.9, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 4 }}
            transition={{ duration: 0.18, ease: [0.0, 0.0, 0.2, 1.0] }}
            className="absolute flex items-center gap-2"
            style={{ right: btnRight, top: btnTop, zIndex: 20, pointerEvents: 'auto' }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="cursor-pointer rounded-full text-white/60 hover:text-white hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmedRect(null);
                    setCursor('crosshair');
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <IconRestart size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Redraw</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isScreenshot ? 'Take screenshot' : 'Start Recording'}
                  className={
                    isScreenshot
                      ? 'cursor-pointer flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f5f7] text-[#111113] shadow-[0_0_14px_rgba(255,255,255,0.35)] hover:bg-white hover:text-[#111113] active:scale-95'
                      : 'cursor-pointer flex h-9 w-9 items-center justify-center rounded-full bg-[#e54d4d] text-white shadow-[0_0_14px_rgba(229,77,77,0.5)] hover:bg-[#ef5f5f] active:scale-95'
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConfirm();
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {isScreenshot ? <IconCamera size={16} /> : <IconPlayerRecordFilled size={14} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {isScreenshot ? 'Take screenshot' : 'Start Recording'}
              </TooltipContent>
            </Tooltip>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
