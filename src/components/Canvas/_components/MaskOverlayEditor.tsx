import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getContainRect } from '../../../lib/effects/frame';
import { useStore } from '../../../store';
import type { MaskClip } from '../../../store';
import { sharedCameraState, transformPointWithSharedCamera } from '../../../lib/effects/zoom/index';

type InteractionState =
  | {
      mode: 'move';
      maskId: string;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startNormX: number;
      startNormY: number;
    }
  | {
      mode: 'resize';
      maskId: string;
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startNormW: number;
      startNormH: number;
    }
  | null;

interface Props {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

const MIN_MASK_SIZE = 0.02;

export const MaskOverlayEditor = ({ containerRef, canvasRef }: Props) => {
  const {
    activeWidget,
    maskClips,
    currentTime,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
    recordingResult,
    setActiveWidget,
  } = useStore(
    useShallow((state) => ({
      activeWidget: state.activeWidget,
      maskClips: state.maskClips,
      currentTime: state.currentTime,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
      recordingResult: state.recordingResult,
      setActiveWidget: state.setActiveWidget,
    })),
  );

  const [box, setBox] = useState({ width: 0, height: 0, canvasWidth: 0, canvasHeight: 0 });
  const [interaction, setInteraction] = useState<InteractionState>(null);

  const isEditing = activeWidget === 'mask';

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
    const observer = new ResizeObserver(update);
    observer.observe(node);
    if (canvasNode) {
      observer.observe(canvasNode);
    }

    const mutationObserver = canvasNode ? new MutationObserver(update) : null;
    if (mutationObserver && canvasNode) {
      mutationObserver.observe(canvasNode, {
        attributes: true,
        attributeFilter: ['width', 'height'],
      });
    }

    return () => {
      observer.disconnect();
      mutationObserver?.disconnect();
    };
  }, [canvasRef, containerRef]);

  const canvasDisplayRect = useMemo(() => {
    if (box.canvasWidth === 0 || box.canvasHeight === 0) {
      return null;
    }
    return getContainRect(box.width, box.height, box.canvasWidth, box.canvasHeight);
  }, [box]);

  const displayScale = canvasDisplayRect
    ? canvasDisplayRect.width / Math.max(box.canvasWidth, 1)
    : 1;

  const activeMasks = useMemo(
    () => maskClips.filter((m) => currentTime >= m.start && currentTime < m.end),
    [maskClips, currentTime],
  );

  const toDisplayRect = useCallback(
    (mask: MaskClip) => {
      if (!canvasDisplayRect) {
        return null;
      }
      const cw = box.canvasWidth;
      const ch = box.canvasHeight;
      const px = mask.x * cw;
      const py = mask.y * ch;
      const pw = mask.width * cw;
      const ph = mask.height * ch;

      // Apply the same camera transform used by the Pixi renderer so handles
      // stay aligned with the rendered mask when zoom/pan is active.
      const tl = transformPointWithSharedCamera(px, py);
      const tr = transformPointWithSharedCamera(px + pw, py);
      const br = transformPointWithSharedCamera(px + pw, py + ph);
      const bl = transformPointWithSharedCamera(px, py + ph);

      const minX = Math.min(tl.x, tr.x, br.x, bl.x);
      const minY = Math.min(tl.y, tr.y, br.y, bl.y);
      const maxX = Math.max(tl.x, tr.x, br.x, bl.x);
      const maxY = Math.max(tl.y, tr.y, br.y, bl.y);

      return {
        x: canvasDisplayRect.x + minX * displayScale,
        y: canvasDisplayRect.y + minY * displayScale,
        w: (maxX - minX) * displayScale,
        h: (maxY - minY) * displayScale,
      };
    },
    [canvasDisplayRect, box, displayScale],
  );

  const pointerMoveHandlerRef = useRef<(e: PointerEvent) => void>(() => undefined);
  const pointerUpHandlerRef = useRef<(e: PointerEvent) => void>(() => undefined);

  useEffect(() => {
    if (!interaction) {
      return;
    }

    pointerMoveHandlerRef.current = (e: PointerEvent) => {
      if (e.pointerId !== interaction.pointerId) {
        return;
      }

      if (interaction.mode === 'move') {
        const dx = e.clientX - interaction.startClientX;
        const dy = e.clientY - interaction.startClientY;
        // Divide by zoom scale so a pointer delta in zoomed screen space maps to
        // the correct content-space delta (e.g. at 2× zoom, 10px drag = 5px content).
        const camScale = Math.max(sharedCameraState.scale, 0.001);
        const scaleW = Math.max(box.canvasWidth * displayScale * camScale, 1);
        const scaleH = Math.max(box.canvasHeight * displayScale * camScale, 1);
        const mask = maskClips.find((m) => m.id === interaction.maskId);
        if (!mask) {
          return;
        }
        const nx = Math.max(0, Math.min(1 - mask.width, interaction.startNormX + dx / scaleW));
        const ny = Math.max(0, Math.min(1 - mask.height, interaction.startNormY + dy / scaleH));
        commitEdit('Move mask', (s) => ({
          maskClips: s.maskClips.map((m) =>
            m.id === interaction.maskId ? { ...m, x: nx, y: ny } : m,
          ),
        }));
        return;
      }

      if (interaction.mode === 'resize') {
        const camScale = Math.max(sharedCameraState.scale, 0.001);
        const dx =
          (e.clientX - interaction.startClientX) /
          Math.max(box.canvasWidth * displayScale * camScale, 1);
        const dy =
          (e.clientY - interaction.startClientY) /
          Math.max(box.canvasHeight * displayScale * camScale, 1);
        const nw = Math.max(MIN_MASK_SIZE, interaction.startNormW + dx);
        const nh = Math.max(MIN_MASK_SIZE, interaction.startNormH + dy);
        commitEdit('Resize mask', (s) => ({
          maskClips: s.maskClips.map((m) =>
            m.id === interaction.maskId ? { ...m, width: nw, height: nh } : m,
          ),
        }));
      }
    };

    pointerUpHandlerRef.current = (e: PointerEvent) => {
      if (e.pointerId !== interaction.pointerId) {
        return;
      }
      if (interaction.mode === 'move') {
        endHistoryGroup('mask-move');
      } else if (interaction.mode === 'resize') {
        endHistoryGroup('mask-resize');
      }
      setInteraction(null);
    };

    const onMove = (e: PointerEvent) => pointerMoveHandlerRef.current(e);
    const onUp = (e: PointerEvent) => pointerUpHandlerRef.current(e);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [box, commitEdit, displayScale, endHistoryGroup, interaction, maskClips]);

  useEffect(() => {
    return () => {
      if (!interaction) {
        return;
      }
      if (interaction.mode === 'move') {
        endHistoryGroup('mask-move');
      } else if (interaction.mode === 'resize') {
        endHistoryGroup('mask-resize');
      }
    };
  }, [interaction, endHistoryGroup]);

  if (!recordingResult) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {activeMasks.map((mask) => {
        const dr = toDisplayRect(mask);
        if (!dr || dr.w < 2 || dr.h < 2) {
          return null;
        }
        const isMoving = interaction?.mode === 'move' && interaction.maskId === mask.id;
        const isResizing = interaction?.mode === 'resize' && interaction.maskId === mask.id;
        const isDragging = isMoving || isResizing;

        return (
          <div
            key={mask.id}
            className="group pointer-events-auto absolute transition-[background-color,box-shadow] duration-150"
            style={{
              left: dr.x,
              top: dr.y,
              width: dr.w,
              height: dr.h,
              cursor: isEditing ? (isMoving ? 'grabbing' : 'grab') : 'pointer',
              background: isEditing
                ? isDragging
                  ? 'linear-gradient(180deg, rgba(19,19,23,0.20), rgba(19,19,23,0.10))'
                  : 'linear-gradient(180deg, rgba(19,19,23,0.12), rgba(19,19,23,0.05))'
                : 'transparent',
              boxShadow: isEditing
                ? isDragging
                  ? '0 0 0 1px rgba(255,106,26,0.26), 0 1px 2px rgba(8,8,10,0.16), 0 10px 22px rgba(8,8,10,0.18), 0 22px 36px rgba(8,8,10,0.12)'
                  : '0 0 0 1px rgba(255,255,255,0.18), 0 1px 2px rgba(8,8,10,0.14), 0 8px 18px rgba(8,8,10,0.14)'
                : 'none',
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) {
                return;
              }
              e.preventDefault();
              e.stopPropagation();
              if (!isEditing) {
                setActiveWidget('mask');
                return;
              }
              beginHistoryGroup('mask-move', 'Move mask');
              setInteraction({
                mode: 'move',
                maskId: mask.id,
                pointerId: e.pointerId,
                startClientX: e.clientX,
                startClientY: e.clientY,
                startNormX: mask.x,
                startNormY: mask.y,
              });
            }}
          >
            {isEditing && (
              <div
                className={`pointer-events-none absolute inset-0 transition-opacity duration-150 ${
                  isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                style={{ boxShadow: 'inset 0 0 0 1px rgba(242,242,244,0.08)' }}
              />
            )}

            {isEditing && (
              <div className="pointer-events-none absolute left-2.5 top-2.5 rounded-full border border-white/7 bg-[#141418]/72 px-2.5 py-1 text-xs font-medium tracking-[0.12em] text-white/78 shadow-[0_1px_1px_rgba(8,8,10,0.18),0_8px_18px_rgba(8,8,10,0.16)] backdrop-blur-md transition-all duration-150">
                {mask.type === 'blur' ? 'Blur' : 'Mask'}
              </div>
            )}

            {isEditing && (
              <button
                type="button"
                aria-label="Resize mask"
                className={`pointer-events-auto absolute bottom-2 right-2 flex h-5 w-5 cursor-se-resize items-center justify-center rounded-full border border-white/8 bg-[#16161a]/78 shadow-[0_1px_1px_rgba(8,8,10,0.18),0_8px_16px_rgba(8,8,10,0.16)] transition-all duration-150 ${
                  isDragging ? 'text-white/60' : 'text-white/44 group-hover:text-white/52'
                }`}
                onPointerDown={(e) => {
                  if (e.button !== 0) {
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  beginHistoryGroup('mask-resize', 'Resize mask');
                  setInteraction({
                    mode: 'resize',
                    maskId: mask.id,
                    pointerId: e.pointerId,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    startNormW: mask.width,
                    startNormH: mask.height,
                  });
                }}
              >
                <span className="pointer-events-none relative block h-2.5 w-2.5">
                  <span className="absolute bottom-0 right-0 h-px w-2 rounded-full bg-current" />
                  <span className="absolute bottom-0 right-0 h-2 w-px rounded-full bg-current" />
                </span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
