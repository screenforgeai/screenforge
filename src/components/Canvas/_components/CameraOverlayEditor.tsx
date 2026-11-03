import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { motion } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { getContainRect } from '../../../lib/effects/frame';
import { useStore } from '../../../store';
import {
  clampCameraPosition,
  getCameraCornerRadius,
  getMinCameraWidth,
  getZoomAdjustedCameraScale,
  resolveCameraRect,
  SIDE_LAYOUT_WIDTH_RATIO,
  toNormalizedSize,
  toNormalizedX,
  toNormalizedY,
} from '../../../lib/effects/camera/layout';
import { interpolateCamera } from '../../../lib/effects/zoom/render';
import { findCameraClipAtTime } from '../../../lib/helpers/segments';

type DragState = {
  mode: 'move' | 'resize';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
} | null;

interface Props {
  containerRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

export const CameraOverlayEditor = ({ containerRef, canvasRef }: Props) => {
  const {
    activeWidget,
    recordingResult,
    camera,
    currentTime,
    zoomClips,
    cameraClips,
    commitEdit,
    beginHistoryGroup,
    endHistoryGroup,
    setActiveWidget,
  } = useStore(
    useShallow((state) => ({
      activeWidget: state.activeWidget,
      recordingResult: state.recordingResult,
      camera: state.camera,
      currentTime: state.currentTime,
      zoomClips: state.zoomClips,
      cameraClips: state.cameraClips,
      commitEdit: state.commitEdit,
      beginHistoryGroup: state.beginHistoryGroup,
      endHistoryGroup: state.endHistoryGroup,
      setActiveWidget: state.setActiveWidget,
    })),
  );

  const [box, setBox] = useState({ width: 0, height: 0, canvasWidth: 0, canvasHeight: 0 });
  const [drag, setDrag] = useState<DragState>(null);
  const isEditing = activeWidget === 'camera';
  const activeClip = findCameraClipAtTime(cameraClips, currentTime);

  const shouldRender =
    Boolean(recordingResult?.cameraPath) && camera.enabled && Boolean(activeClip);

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
    mutationObserver?.observe(canvasNode, {
      attributes: true,
      attributeFilter: ['width', 'height'],
    });

    return () => {
      observer.disconnect();
      mutationObserver?.disconnect();
    };
  }, [canvasRef, containerRef, recordingResult?.filePath, shouldRender]);

  const activeLayout = activeClip?.layout ?? 'pip';
  const isPipLayout = activeLayout === 'pip';

  // Disable layout animation when zoom is active. During zoom the overlay position
  // changes every frame (tracking the zoomed camera), so the 0.22s layout transition
  // would chase a moving target and produce a jerk at the end of the zoom.
  const currentZoomScale = isPipLayout
    ? (interpolateCamera(zoomClips, currentTime)?.scale ?? 1)
    : 1;

  const rect = useMemo(() => {
    if (!shouldRender || !activeClip) {
      return null;
    }
    const canvasDisplayRect = getContainRect(
      box.width,
      box.height,
      box.canvasWidth,
      box.canvasHeight,
    );
    const displayScale = canvasDisplayRect.width / Math.max(box.canvasWidth, 1);

    let canvasRect;
    if (isPipLayout) {
      const zoomScale = interpolateCamera(zoomClips, currentTime)?.scale ?? 1;
      const effectiveCamera = {
        ...camera,
        x: activeClip.x,
        y: activeClip.y,
        size: activeClip.size,
      };
      canvasRect = resolveCameraRect(effectiveCamera, box.canvasWidth, box.canvasHeight, zoomScale);
    } else if (activeLayout === 'full') {
      canvasRect = {
        x: 0,
        y: 0,
        width: box.canvasWidth,
        height: box.canvasHeight,
        baseX: 0,
        baseY: 0,
        baseWidth: box.canvasWidth,
        baseHeight: box.canvasHeight,
      };
    } else if (activeLayout === 'left' || activeLayout === 'right') {
      const sideW = box.canvasWidth * SIDE_LAYOUT_WIDTH_RATIO;
      const pad = camera.fixedPadding * (box.canvasHeight / 1080);
      const camPanelX = activeLayout === 'left' ? 0 : box.canvasWidth - sideW;
      canvasRect = {
        x: camPanelX + pad,
        y: pad,
        width: sideW - pad * 2,
        height: box.canvasHeight - pad * 2,
        baseX: camPanelX + pad,
        baseY: pad,
        baseWidth: sideW - pad * 2,
        baseHeight: box.canvasHeight - pad * 2,
      };
    }
    if (!canvasRect) {
      return null;
    }
    return {
      canvasWidth: box.canvasWidth,
      canvasHeight: box.canvasHeight,
      canvasX: canvasRect.x,
      canvasY: canvasRect.y,
      canvasBaseX: canvasRect.baseX,
      canvasBaseY: canvasRect.baseY,
      baseWidth: canvasRect.baseWidth,
      baseHeight: canvasRect.baseHeight,
      displayScale,
      x: canvasDisplayRect.x + canvasRect.x * displayScale,
      y: canvasDisplayRect.y + canvasRect.y * displayScale,
      width: canvasRect.width * displayScale,
      height: canvasRect.height * displayScale,
    };
  }, [
    activeClip,
    activeLayout,
    box.canvasHeight,
    box.canvasWidth,
    box.height,
    box.width,
    camera,
    currentTime,
    isPipLayout,
    shouldRender,
    zoomClips,
  ]);

  const updateCameraClip = useCallback(
    (label: string, patch: { x?: number; y?: number; size?: number }) => {
      if (!activeClip) {
        return;
      }
      commitEdit(label, (state) => ({
        cameraClips: state.cameraClips.map((c) =>
          c.id === activeClip.id ? { ...c, ...patch } : c,
        ),
      }));
    },
    [commitEdit, activeClip],
  );

  const pointerMoveHandlerRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const pointerUpHandlerRef = useRef<(event: PointerEvent) => void>(() => undefined);

  useEffect(() => {
    if (!drag || !rect) {
      return;
    }

    pointerMoveHandlerRef.current = (event: PointerEvent) => {
      if (!rect || event.pointerId !== drag.pointerId) {
        return;
      }

      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      const scale = Math.max(rect.displayScale, 0.001);

      if (drag.mode === 'move') {
        const next = clampCameraPosition(
          drag.startX + dx / scale,
          drag.startY + dy / scale,
          drag.startWidth,
          drag.startHeight,
          rect.canvasWidth,
          rect.canvasHeight,
        );

        updateCameraClip('Move camera', {
          x: toNormalizedX(next.x, rect.canvasWidth),
          y: toNormalizedY(next.y, rect.canvasHeight),
        });
        return;
      }

      const aspect = drag.startWidth / Math.max(drag.startHeight, 1);
      const minWidth = getMinCameraWidth(rect.canvasWidth);
      const maxWidthByX = Math.max(minWidth, rect.canvasWidth - drag.startX);
      const maxWidthByY = Math.max(minWidth, (rect.canvasHeight - drag.startY) * aspect);
      const maxWidth = Math.min(maxWidthByX, maxWidthByY);
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, drag.startWidth + dx / scale));
      const zoomScale = interpolateCamera(zoomClips, currentTime)?.scale ?? 1;
      const zoomAdjustedScale = getZoomAdjustedCameraScale(camera, zoomScale);
      const baseWidth = nextWidth / Math.max(zoomAdjustedScale, 0.001);

      updateCameraClip('Resize camera', {
        size: toNormalizedSize(baseWidth, rect.canvasWidth),
      });
    };

    pointerUpHandlerRef.current = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) {
        return;
      }
      if (drag.mode === 'move') {
        endHistoryGroup('camera-position');
      } else {
        endHistoryGroup('camera-size');
      }
      setDrag(null);
    };

    const onPointerMove = (event: PointerEvent) => pointerMoveHandlerRef.current(event);
    const onPointerUp = (event: PointerEvent) => pointerUpHandlerRef.current(event);

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [camera, currentTime, drag, endHistoryGroup, rect, updateCameraClip, zoomClips]);

  useEffect(() => {
    return () => {
      if (!drag) {
        return;
      }
      if (drag.mode === 'move') {
        endHistoryGroup('camera-position');
      } else {
        endHistoryGroup('camera-size');
      }
    };
  }, [drag, endHistoryGroup]);

  if (!shouldRender || !rect) {
    return null;
  }

  const isDragging = drag !== null;
  const radius =
    activeLayout === 'pip'
      ? getCameraCornerRadius(camera, rect.width, rect.height)
      : activeLayout === 'full'
        ? 0
        : Math.max(0, camera.fixedRadius * (box.canvasHeight / 1080)) * rect.displayScale;
  const borderRadius = `${radius}px`;
  const surfaceRadius = `${Math.max(0, radius - 1)}px`;
  const chromeInset = Math.max(8, Math.min(radius * 0.3, 18));

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <motion.div
        layout={drag === null && currentZoomScale < 1.001}
        transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
        className="group pointer-events-auto absolute rounded-md transition-[background-color] duration-150"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          borderRadius,
          cursor: isEditing
            ? isPipLayout
              ? drag?.mode === 'move'
                ? 'grabbing'
                : 'grab'
              : 'default'
            : 'pointer',
          background: isEditing
            ? isDragging
              ? 'linear-gradient(180deg, rgba(19,19,23,0.20), rgba(19,19,23,0.10))'
              : 'linear-gradient(180deg, rgba(19,19,23,0.12), rgba(19,19,23,0.05))'
            : 'transparent',
          boxShadow: isEditing
            ? isDragging
              ? '0 0 0 1px rgba(255,106,26,0.26), 0 1px 2px rgba(8,8,10,0.16), 0 10px 22px rgba(8,8,10,0.18), 0 22px 36px rgba(8,8,10,0.12)'
              : '0 1px 2px rgba(8,8,10,0.14), 0 8px 18px rgba(8,8,10,0.14), 0 18px 30px rgba(8,8,10,0.09)'
            : 'none',
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          event.preventDefault();
          if (!isEditing) {
            setActiveWidget('camera');
            return;
          }
          if (!isPipLayout) {
            return;
          }
          beginHistoryGroup('camera-position', 'Move camera');
          setDrag({
            mode: 'move',
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startClientY: event.clientY,
            startX: rect.canvasBaseX,
            startY: rect.canvasBaseY,
            startWidth: rect.baseWidth,
            startHeight: rect.baseHeight,
          });
        }}
      >
        {isEditing && (
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden"
            style={{
              borderRadius: surfaceRadius,
              boxShadow:
                'inset 0 0 0 1px rgba(255,255,255,0.07), inset 0 1px 0 rgba(255,255,255,0.05)',
              background: isDragging
                ? 'linear-gradient(180deg, rgba(19,19,23,0.20), rgba(19,19,23,0.10))'
                : 'linear-gradient(180deg, rgba(19,19,23,0.12), rgba(19,19,23,0.05))',
            }}
          >
            <div
              className={`absolute inset-0 transition-opacity duration-150 ${
                isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              style={{
                borderRadius: surfaceRadius,
                boxShadow: 'inset 0 0 0 1px rgba(242,242,244,0.08)',
              }}
            />
          </div>
        )}

        {isEditing && (
          <div
            className="absolute left-2.5 top-2.5 rounded-full border border-white/7 bg-[#141418]/72 px-2.5 py-1 text-xs font-medium tracking-[0.12em] text-white/78 shadow-[0_1px_1px_rgba(8,8,10,0.18),0_8px_18px_rgba(8,8,10,0.16)] backdrop-blur-md transition-all duration-150"
            style={{
              left: chromeInset,
              top: chromeInset,
            }}
          >
            Camera
          </div>
        )}

        {isEditing && isPipLayout && (
          <button
            type="button"
            aria-label="Resize camera"
            className={`absolute bottom-2 right-2 flex h-5 w-5 cursor-se-resize items-center justify-center rounded-full border border-white/8 bg-[#16161a]/78 shadow-[0_1px_1px_rgba(8,8,10,0.18),0_8px_16px_rgba(8,8,10,0.16)] transition-all duration-150 ${
              isDragging
                ? 'scale-100 text-white/60'
                : 'scale-100 text-white/44 group-hover:text-white/52'
            }`}
            style={{
              bottom: chromeInset,
              right: chromeInset,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              beginHistoryGroup('camera-size', 'Resize camera');
              setDrag({
                mode: 'resize',
                pointerId: event.pointerId,
                startClientX: event.clientX,
                startClientY: event.clientY,
                startX: rect.canvasX,
                startY: rect.canvasY,
                startWidth: rect.width / Math.max(rect.displayScale, 0.001),
                startHeight: rect.height / Math.max(rect.displayScale, 0.001),
              });
            }}
          >
            <span className="pointer-events-none relative block h-2.5 w-2.5">
              <span className="absolute bottom-0 right-0 h-px w-2 rounded-full bg-current" />
              <span className="absolute bottom-0 right-0 h-2 w-px rounded-full bg-current" />
            </span>
          </button>
        )}
      </motion.div>
    </div>
  );
};
