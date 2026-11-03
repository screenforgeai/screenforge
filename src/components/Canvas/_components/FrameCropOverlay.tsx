import { createScreenforgeFileUrl } from 'src/lib/screenforge-url';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import {
  DEFAULT_CROP_RECT,
  getContainRect,
  getFrameGeometry,
  moveCropRect,
  resizeCropRectFromHandle,
} from 'src/lib/effects/frame';
import type { CropHandle, CropRect } from 'src/lib/effects/frame';
import { useStore } from 'src/store';

interface FrameCropOverlayProps {
  containerRef: RefObject<HTMLDivElement | null>;
  sourceWidth: number;
  sourceHeight: number;
}

type InteractionState =
  | {
      type: 'move';
      startRect: CropRect;
      startPointerSourceX: number;
      startPointerSourceY: number;
    }
  | {
      type: 'resize';
      handle: CropHandle;
      startRect: CropRect;
      startPointerSourceX: number;
      startPointerSourceY: number;
    };

const HANDLE_POSITIONS: Record<CropHandle, string> = {
  n: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize',
  s: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize',
  e: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
  w: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize',
  nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize',
  ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize',
  sw: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize',
  se: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize',
};

export const FrameCropOverlay = ({
  containerRef,
  sourceWidth,
  sourceHeight,
}: FrameCropOverlayProps) => {
  const recordingResult = useStore((s) => s.recordingResult);
  const currentTime = useStore((s) => s.currentTime);
  const frame = useStore((s) => s.frame);
  const commitEdit = useStore((s) => s.commitEdit);
  const beginHistoryGroup = useStore((s) => s.beginHistoryGroup);
  const endHistoryGroup = useStore((s) => s.endHistoryGroup);

  const overlayVideoRef = useRef<HTMLVideoElement>(null);
  const sourceBoundsRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<InteractionState | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [activeCursor, setActiveCursor] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const resolvedSourceWidth = Math.max(sourceWidth, 1);
  const resolvedSourceHeight = Math.max(sourceHeight, 1);

  // Use full-source crop rect so the canvas display size stays stable while the
  // user drags handles (for 'original' AR, canvas == cropRect, which would resize live).
  const stableGeometry = useMemo(
    () =>
      getFrameGeometry(
        { ...frame, cropRect: DEFAULT_CROP_RECT },
        resolvedSourceWidth,
        resolvedSourceHeight,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frame.aspectRatioId, frame.background.padding, resolvedSourceWidth, resolvedSourceHeight],
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const update = () =>
      setContainerSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    const video = overlayVideoRef.current;
    if (!video) {
      return;
    }

    if (Math.abs(video.currentTime - currentTime) > 0.05) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  const canvasDisplayRect = useMemo(
    () =>
      getContainRect(
        containerSize.width,
        containerSize.height,
        stableGeometry.canvasWidth,
        stableGeometry.canvasHeight,
      ),
    [
      containerSize.height,
      containerSize.width,
      stableGeometry.canvasHeight,
      stableGeometry.canvasWidth,
    ],
  );

  const contentDisplayRect = useMemo(() => {
    const scale = canvasDisplayRect.width / Math.max(stableGeometry.canvasWidth, 1);
    return {
      x: canvasDisplayRect.x + stableGeometry.contentRect.x * scale,
      y: canvasDisplayRect.y + stableGeometry.contentRect.y * scale,
      width: stableGeometry.contentRect.width * scale,
      height: stableGeometry.contentRect.height * scale,
    };
  }, [canvasDisplayRect, stableGeometry.canvasWidth, stableGeometry.contentRect]);

  const sourceDisplayRect = useMemo(() => {
    const inner = getContainRect(
      contentDisplayRect.width,
      contentDisplayRect.height,
      resolvedSourceWidth,
      resolvedSourceHeight,
    );

    return {
      x: contentDisplayRect.x + inner.x,
      y: contentDisplayRect.y + inner.y,
      width: inner.width,
      height: inner.height,
    };
  }, [contentDisplayRect, resolvedSourceHeight, resolvedSourceWidth]);

  const cropOverlayRect = useMemo(() => {
    const x = Math.min(Math.max(frame.cropRect.x, 0), 1);
    const y = Math.min(Math.max(frame.cropRect.y, 0), 1);
    const width = Math.min(Math.max(frame.cropRect.width, 0), 1 - x);
    const height = Math.min(Math.max(frame.cropRect.height, 0), 1 - y);
    return {
      x,
      y,
      width,
      height,
      rightGap: Math.max(0, 1 - (x + width)),
      bottomGap: Math.max(0, 1 - (y + height)),
    };
  }, [frame.cropRect]);

  const getPointerSourcePoint = (clientX: number, clientY: number) => {
    const bounds = sourceBoundsRef.current?.getBoundingClientRect();
    if (bounds) {
      return {
        x: ((clientX - bounds.left) / Math.max(bounds.width, 1)) * resolvedSourceWidth,
        y: ((clientY - bounds.top) / Math.max(bounds.height, 1)) * resolvedSourceHeight,
      };
    }

    const containerBounds = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return {
      x:
        ((clientX - containerBounds.left - sourceDisplayRect.x) /
          Math.max(sourceDisplayRect.width, 1)) *
        resolvedSourceWidth,
      y:
        ((clientY - containerBounds.top - sourceDisplayRect.y) /
          Math.max(sourceDisplayRect.height, 1)) *
        resolvedSourceHeight,
    };
  };

  const updateCropRect = (label: string, nextRect: CropRect) => {
    commitEdit(label, (state) => ({
      frame: {
        ...state.frame,
        cropRect: nextRect,
      },
    }));
  };

  const startInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    interaction: InteractionState,
    historyKey: string,
    historyLabel: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    interactionRef.current = interaction;
    beginHistoryGroup(historyKey, historyLabel);
    setIsDragging(true);

    if (interaction.type === 'move') {
      setActiveCursor('move');
    } else {
      const cursorClass = HANDLE_POSITIONS[interaction.handle]
        .split(' ')
        .find((c) => c.startsWith('cursor-'));
      setActiveCursor(cursorClass ? cursorClass.slice('cursor-'.length) : 'default');
    }

    const onMove = (moveEvent: PointerEvent) => {
      const active = interactionRef.current;
      if (!active) {
        return;
      }

      if (active.type === 'move') {
        const point = getPointerSourcePoint(moveEvent.clientX, moveEvent.clientY);
        const nextRect = moveCropRect(
          active.startRect,
          (point.x - active.startPointerSourceX) / Math.max(resolvedSourceWidth, 1),
          (point.y - active.startPointerSourceY) / Math.max(resolvedSourceHeight, 1),
        );
        updateCropRect('Move crop', nextRect);
        return;
      }

      const point = getPointerSourcePoint(moveEvent.clientX, moveEvent.clientY);
      const startLeft = active.startRect.x * resolvedSourceWidth;
      const startTop = active.startRect.y * resolvedSourceHeight;
      const startRight = (active.startRect.x + active.startRect.width) * resolvedSourceWidth;
      const startBottom = (active.startRect.y + active.startRect.height) * resolvedSourceHeight;

      let pointerX = point.x;
      let pointerY = point.y;

      // Keep the original grab offset so the edge follows the drag naturally.
      if (active.handle.includes('w')) {
        pointerX -= active.startPointerSourceX - startLeft;
      }
      if (active.handle.includes('e')) {
        pointerX -= active.startPointerSourceX - startRight;
      }
      if (active.handle.includes('n')) {
        pointerY -= active.startPointerSourceY - startTop;
      }
      if (active.handle.includes('s')) {
        pointerY -= active.startPointerSourceY - startBottom;
      }

      const nextRect = resizeCropRectFromHandle(
        active.startRect,
        active.handle,
        pointerX,
        pointerY,
        resolvedSourceWidth,
        resolvedSourceHeight,
      );
      updateCropRect('Resize crop', nextRect);
    };

    const onUp = () => {
      interactionRef.current = null;
      endHistoryGroup(historyKey);
      setActiveCursor(null);
      setIsDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  if (!recordingResult) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 z-10 select-none rounded-[inherit]"
      style={{ cursor: isDragging ? 'none' : (activeCursor ?? undefined) }}
    >
      <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[11px] text-white/80">
        Editing crop
      </div>

      <div
        ref={sourceBoundsRef}
        className="absolute"
        style={{
          left: sourceDisplayRect.x,
          top: sourceDisplayRect.y,
          width: sourceDisplayRect.width,
          height: sourceDisplayRect.height,
        }}
      >
        <video
          ref={overlayVideoRef}
          src={createScreenforgeFileUrl(recordingResult.filePath)}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          muted
          preload="metadata"
        />

        <div className="pointer-events-none absolute inset-0 rounded-[inherit] border border-white/8" />

        <div
          className="pointer-events-none absolute bg-black/60"
          style={{
            left: '0%',
            top: '0%',
            width: '100%',
            height: `${cropOverlayRect.y * 100}%`,
          }}
        />
        <div
          className="pointer-events-none absolute bg-black/60"
          style={{
            left: '0%',
            top: `${cropOverlayRect.y * 100}%`,
            width: `${cropOverlayRect.x * 100}%`,
            height: `${cropOverlayRect.height * 100}%`,
          }}
        />
        <div
          className="pointer-events-none absolute bg-black/60"
          style={{
            left: `${(cropOverlayRect.x + cropOverlayRect.width) * 100}%`,
            top: `${cropOverlayRect.y * 100}%`,
            width: `${cropOverlayRect.rightGap * 100}%`,
            height: `${cropOverlayRect.height * 100}%`,
          }}
        />
        <div
          className="pointer-events-none absolute bg-black/60"
          style={{
            left: '0%',
            top: `${(cropOverlayRect.y + cropOverlayRect.height) * 100}%`,
            width: '100%',
            height: `${cropOverlayRect.bottomGap * 100}%`,
          }}
        />

        <div
          className="absolute cursor-move border border-sf-secondary/80 bg-white/[0.03] shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
          style={{
            left: `${cropOverlayRect.x * 100}%`,
            top: `${cropOverlayRect.y * 100}%`,
            width: `${cropOverlayRect.width * 100}%`,
            height: `${cropOverlayRect.height * 100}%`,
            touchAction: 'none',
          }}
          onPointerDown={(event) => {
            const point = getPointerSourcePoint(event.clientX, event.clientY);
            startInteraction(
              event,
              {
                type: 'move',
                startRect: frame.cropRect,
                startPointerSourceX: point.x,
                startPointerSourceY: point.y,
              },
              'frame-crop-move',
              'Move crop',
            );
          }}
        >
          <div className="pointer-events-none absolute inset-0 border border-white/15" />
          <div
            className="pointer-events-none absolute top-0 h-full w-px border-l border-dashed border-white/20"
            style={{ left: '33.3333%' }}
          />
          <div
            className="pointer-events-none absolute top-0 h-full w-px border-l border-dashed border-white/20"
            style={{ left: '66.6667%' }}
          />
          <div
            className="pointer-events-none absolute left-0 h-px w-full border-t border-dashed border-white/20"
            style={{ top: '33.3333%' }}
          />
          <div
            className="pointer-events-none absolute left-0 h-px w-full border-t border-dashed border-white/20"
            style={{ top: '66.6667%' }}
          />

          {(['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as CropHandle[]).map((handle) => (
            <button
              key={handle}
              type="button"
              aria-label={`Resize crop ${handle}`}
              className={`absolute h-5 w-5 rounded-full ${HANDLE_POSITIONS[handle]}`}
              style={{ touchAction: 'none' }}
              onPointerDown={(event) => {
                const point = getPointerSourcePoint(event.clientX, event.clientY);
                startInteraction(
                  event,
                  {
                    type: 'resize',
                    handle,
                    startRect: frame.cropRect,
                    startPointerSourceX: point.x,
                    startPointerSourceY: point.y,
                  },
                  `frame-crop-${handle}`,
                  'Resize crop',
                );
              }}
            >
              <span className="pointer-events-none absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sf-secondary bg-[#111827] shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
