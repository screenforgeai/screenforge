import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../../store';
import type { TextClip } from '../../../store';
import { getContainRect } from '../../../lib/effects/frame';
import { cn } from '../../../lib/utils';

const REFERENCE_HEIGHT = 1080;

let _sharedCtx: CanvasRenderingContext2D | null = null;

function getSharedCtx(): CanvasRenderingContext2D | null {
  if (!_sharedCtx) {
    const canvas = document.createElement('canvas');
    _sharedCtx = canvas.getContext('2d');
  }
  return _sharedCtx;
}

// Measures in canvas-pixel space (matching the renderer exactly), then converts to display pixels.
function measureClipDisplayHeight(
  clip: TextClip,
  canvasWidth: number,
  canvasHeight: number,
  displayScale: number,
): number {
  if (canvasWidth === 0 || canvasHeight === 0) {
    return 0;
  }

  const ctx = getSharedCtx();
  const canvasScale = canvasHeight / REFERENCE_HEIGHT;
  const fontSize = Math.round(clip.fontSize * canvasScale);
  const maxWidth = clip.width * canvasWidth;
  const lineHeight = fontSize * 1.35;
  const pad = Math.round(clip.backgroundPadding * canvasScale);

  if (!ctx || !clip.content) {
    return (lineHeight + 2 * pad) * displayScale;
  }

  const fontStyle = [
    clip.italic ? 'italic' : '',
    clip.bold ? 'bold' : '',
    `${fontSize}px`,
    `"${clip.fontFamily}", sans-serif`,
  ]
    .filter(Boolean)
    .join(' ');
  ctx.font = fontStyle;

  const words = clip.content.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) {
    lines.push(current);
  }

  return (Math.max(1, lines.length) * lineHeight + 2 * pad) * displayScale;
}

interface Box {
  width: number;
  height: number;
  canvasWidth: number;
  canvasHeight: number;
}

type HandleId = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

type DragState = {
  mode: 'move' | 'resize';
  handle: HandleId | null;
  clipId: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  moved: boolean;
};

const HANDLE_POSITIONS: { id: HandleId; top: string; left: string; cursor: string }[] = [
  { id: 'tl', top: '0%', left: '0%', cursor: 'nwse-resize' },
  { id: 'tc', top: '0%', left: '50%', cursor: 'ns-resize' },
  { id: 'tr', top: '0%', left: '100%', cursor: 'nesw-resize' },
  { id: 'ml', top: '50%', left: '0%', cursor: 'ew-resize' },
  { id: 'mr', top: '50%', left: '100%', cursor: 'ew-resize' },
  { id: 'bl', top: '100%', left: '0%', cursor: 'nesw-resize' },
  { id: 'bc', top: '100%', left: '50%', cursor: 'ns-resize' },
  { id: 'br', top: '100%', left: '100%', cursor: 'nwse-resize' },
];

interface Props {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export const TextOverlayEditor = ({ containerRef, canvasRef }: Props) => {
  const {
    activeWidget,
    recordingResult,
    textClips,
    selectedClip,
    currentTime,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
    setSelectedClip,
    setActiveWidget,
    requestPauseAndSeekTo,
  } = useStore(
    useShallow((state) => ({
      activeWidget: state.activeWidget,
      recordingResult: state.recordingResult,
      textClips: state.textClips,
      selectedClip: state.selectedClip,
      currentTime: state.currentTime,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
      setSelectedClip: state.setSelectedClip,
      setActiveWidget: state.setActiveWidget,
      requestPauseAndSeekTo: state.requestPauseAndSeekTo,
    })),
  );

  const [box, setBox] = useState<Box>({ width: 0, height: 0, canvasWidth: 0, canvasHeight: 0 });
  const dragRef = useRef<DragState | null>(null);

  const isEditing = activeWidget === 'text';
  const selectedId = selectedClip?.effectId === 'text' ? selectedClip.id : null;

  useEffect(() => {
    const node = containerRef.current;
    const canvasNode = canvasRef.current;
    if (!node) {
      return;
    }

    const update = () => {
      setBox({
        width: node.clientWidth,
        height: node.clientHeight,
        canvasWidth: canvasNode?.width ?? 0,
        canvasHeight: canvasNode?.height ?? 0,
      });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    if (canvasNode) {
      ro.observe(canvasNode);
    }

    const mo = canvasNode ? new MutationObserver(update) : null;
    if (canvasNode && mo) {
      mo.observe(canvasNode, { attributes: true, attributeFilter: ['width', 'height'] });
    }

    return () => {
      ro.disconnect();
      mo?.disconnect();
    };
  }, [canvasRef, containerRef, recordingResult?.filePath]);

  const canvasDisplayRect = useMemo(
    () => getContainRect(box.width, box.height, box.canvasWidth, box.canvasHeight),
    [box],
  );

  const displayedW = Math.max(box.canvasWidth, 1);
  const displayedH = Math.max(box.canvasHeight, 1);
  const displayScale = canvasDisplayRect.width / displayedW;

  const toPixelX = useCallback(
    (nx: number) => canvasDisplayRect.x + nx * displayedW * displayScale,
    [canvasDisplayRect.x, displayedW, displayScale],
  );
  const toPixelY = useCallback(
    (ny: number) => canvasDisplayRect.y + ny * displayedH * displayScale,
    [canvasDisplayRect.y, displayedH, displayScale],
  );
  const toPixelW = useCallback(
    (nw: number) => nw * displayedW * displayScale,
    [displayedW, displayScale],
  );

  const toNormDx = useCallback(
    (dx: number) => dx / (displayedW * displayScale),
    [displayedW, displayScale],
  );
  const toNormDy = useCallback(
    (dy: number) => dy / (displayedH * displayScale),
    [displayedH, displayScale],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) {
        return;
      }

      const dx = e.clientX - drag.startClientX;
      const dy = e.clientY - drag.startClientY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        drag.moved = true;
      }
      if (!drag.moved) {
        return;
      }

      if (drag.mode === 'move') {
        const newX = Math.max(0, Math.min(1 - drag.startWidth, drag.startX + toNormDx(dx)));
        const newY = Math.max(0, Math.min(0.95, drag.startY + toNormDy(dy)));
        commitEdit('Move text', (state) => ({
          textClips: state.textClips.map((c) =>
            c.id === drag.clipId ? { ...c, x: newX, y: newY } : c,
          ),
        }));
      } else if (drag.mode === 'resize' && drag.handle) {
        const h = drag.handle;
        const dxNorm = toNormDx(dx);
        const dyNorm = toNormDy(dy);

        let newX = drag.startX;
        let newW = drag.startWidth;
        let newY = drag.startY;
        let newH = drag.startHeight;

        // Horizontal component
        if (h === 'mr' || h === 'tr' || h === 'br') {
          newW = Math.max(0.05, Math.min(1 - drag.startX, drag.startWidth + dxNorm));
        } else if (h === 'ml' || h === 'tl' || h === 'bl') {
          const tentativeX = Math.max(0, drag.startX + dxNorm);
          const tentativeW = Math.max(0.05, drag.startWidth - dxNorm);
          if (tentativeX + tentativeW <= 1) {
            newX = tentativeX;
            newW = tentativeW;
          }
        }

        // Vertical component
        if (h === 'bc' || h === 'bl' || h === 'br') {
          newH = Math.max(0.03, drag.startHeight + dyNorm);
        } else if (h === 'tc' || h === 'tl' || h === 'tr') {
          newY = Math.max(0, drag.startY + dyNorm);
          newH = Math.max(0.03, drag.startHeight - dyNorm);
        }

        commitEdit('Resize text', (state) => ({
          textClips: state.textClips.map((c) =>
            c.id === drag.clipId ? { ...c, x: newX, y: newY, width: newW, height: newH } : c,
          ),
        }));
      }
    };

    const onUp = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) {
        return;
      }

      endHistoryGroup(`text-${drag.mode}-${drag.clipId}`);

      if (!drag.moved) {
        setSelectedClip({ id: drag.clipId, effectId: 'text' });
      }

      dragRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [commitEdit, endHistoryGroup, setSelectedClip, toNormDx, toNormDy]);

  if (!recordingResult || textClips.length === 0 || box.canvasWidth === 0) {
    return null;
  }

  return (
    <div
      className={cn('absolute inset-0', isEditing ? 'pointer-events-auto' : 'pointer-events-none')}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && isEditing) {
          setSelectedClip(null);
          setActiveWidget('frame');
        }
      }}
    >
      {textClips.map((clip) => {
        const px = toPixelX(clip.x);
        const pw = toPixelW(clip.width);
        const ph =
          clip.height !== undefined
            ? clip.height * displayedH * displayScale
            : measureClipDisplayHeight(clip, box.canvasWidth, box.canvasHeight, displayScale);

        // Align overlay top with the rendered background box top (which starts pad above text baseline)
        const padDisplay =
          Math.round(clip.backgroundPadding * (box.canvasHeight / REFERENCE_HEIGHT)) * displayScale;
        const py = toPixelY(clip.y) - padDisplay;

        const isSelected = selectedId === clip.id;
        const label = clip.content.slice(0, 20) || 'Text';

        return (
          <div
            key={clip.id}
            className={cn(
              'group pointer-events-auto absolute transition-[box-shadow,background-color] duration-150',
            )}
            style={{
              left: px,
              top: py,
              width: pw,
              height: ph,
              borderRadius: 3,
              cursor: isEditing ? 'move' : 'pointer',
              background: isSelected ? 'rgba(19,19,23,0.06)' : 'transparent',
              boxShadow: isSelected
                ? '0 0 0 1.5px rgba(255,106,26,0.42), inset 0 0 0 1px rgba(255,255,255,0.06)'
                : 'none',
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) {
                return;
              }
              e.stopPropagation();
              e.preventDefault();
              if (!isEditing) {
                setActiveWidget('text');
                setSelectedClip({ id: clip.id, effectId: 'text' });
                return;
              }
              setSelectedClip({ id: clip.id, effectId: 'text' });
              requestPauseAndSeekTo(currentTime);
              beginHistoryGroup(`text-move-${clip.id}`, 'Move text');
              dragRef.current = {
                mode: 'move',
                handle: null,
                clipId: clip.id,
                pointerId: e.pointerId,
                startClientX: e.clientX,
                startClientY: e.clientY,
                startX: clip.x,
                startY: clip.y,
                startWidth: clip.width,
                startHeight: clip.height ?? 0.1,
                moved: false,
              };
            }}
          >
            {/* Hover outline */}
            {!isSelected && (
              <div
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                style={{
                  borderRadius: 3,
                  outline: isEditing
                    ? '1px dashed rgba(255,255,255,0.22)'
                    : '1px solid rgba(255,106,26,0.35)',
                  outlineOffset: 0,
                }}
              />
            )}

            {/* Label badge */}
            {isSelected && (
              <div
                className="pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded-full border border-white/[0.07] bg-[#141418]/[0.82] px-2 py-0.5 text-[10px] font-medium tracking-[0.1em] text-white/70 backdrop-blur-md"
                style={{ maxWidth: pw }}
              >
                {label}
              </div>
            )}

            {/* Resize handles */}
            {isSelected &&
              HANDLE_POSITIONS.map(({ id, top, left, cursor }) => (
                <div
                  key={id}
                  className="absolute z-10 size-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.18),0_1px_4px_rgba(0,0,0,0.35)]"
                  style={{ top, left, cursor }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedClip({ id: clip.id, effectId: 'text' });
                    requestPauseAndSeekTo(currentTime);
                    beginHistoryGroup(`text-resize-${clip.id}`, 'Resize text');
                    dragRef.current = {
                      mode: 'resize',
                      handle: id,
                      clipId: clip.id,
                      pointerId: e.pointerId,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      startX: clip.x,
                      startY: clip.y,
                      startWidth: clip.width,
                      startHeight: clip.height ?? 0.1,
                      moved: false,
                    };
                  }}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
};
