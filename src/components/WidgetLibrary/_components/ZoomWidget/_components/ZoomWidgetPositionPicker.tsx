import { createScreenforgeFileUrl } from 'src/lib/screenforge-url';
import type { CropRect } from 'src/lib/effects/frame';
import { useRef, useCallback, useEffect, useState } from 'react';

const MAX_HEIGHT_PX = 220;

interface Props {
  videoPath: string;
  videoTime: number;
  /** The frame's crop: the picker shows the same picture the zoom targets. */
  crop: CropRect;
  cx: number;
  cy: number;
  scale: number;
  onChange: (cx: number, cy: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/**
 * A small video thumbnail with a draggable crosshair.
 * The semi-transparent rectangle shows the area that will be zoomed into.
 * It shows only the cropped picture, at its shape, so positions on it are the
 * zoom's own positions.
 */
export const ZoomPositionPicker = ({
  videoPath,
  videoTime,
  crop,
  cx,
  cy,
  scale,
  onChange,
  onDragStart,
  onDragEnd,
}: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
  const aspectRatio = videoSize
    ? (crop.width * videoSize.width) / (crop.height * videoSize.height)
    : 16 / 9;

  // Seek hidden video to current playhead time
  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (Math.abs(video.currentTime - videoTime) > 0.1) {
      video.currentTime = videoTime;
    }
  }, [videoTime]);

  const posFromEvent = useCallback((e: MouseEvent | React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();

    if (!rect) {
      return null;
    }

    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    return { x, y };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();

      dragging.current = true;
      onDragStart?.();
      const pos = posFromEvent(e);

      if (pos) {
        onChange(pos.x, pos.y);
      }

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) {
          return;
        }
        const p = posFromEvent(ev);
        if (p) {
          onChange(p.x, p.y);
        }
      };

      const onUp = () => {
        dragging.current = false;
        onDragEnd?.();
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [onChange, onDragEnd, onDragStart, posFromEvent],
  );

  // Viewport rectangle: the visible area at this zoom level centered on cx/cy
  const vpW = 1 / scale;
  const vpH = 1 / scale;
  const vpLeft = Math.max(0, Math.min(1 - vpW, cx - vpW / 2));
  const vpTop = Math.max(0, Math.min(1 - vpH, cy - vpH / 2));

  return (
    <div
      ref={containerRef}
      className="relative mx-auto rounded overflow-hidden cursor-crosshair select-none"
      style={{
        aspectRatio: `${aspectRatio}`,
        // Full width, but no taller than MAX_HEIGHT_PX for a tall, narrow crop.
        width: `min(100%, ${MAX_HEIGHT_PX * aspectRatio}px)`,
        background: '#111',
      }}
      data-aspect-ratio={aspectRatio}
      onMouseDown={handleMouseDown}
    >
      {/* Hidden video for frame thumbnail, scaled and shifted so the crop fills the picker */}
      <video
        ref={videoRef}
        src={createScreenforgeFileUrl(videoPath)}
        className="absolute max-w-none object-fill pointer-events-none"
        style={{
          width: `${100 / crop.width}%`,
          height: `${100 / crop.height}%`,
          left: `${(-crop.x / crop.width) * 100}%`,
          top: `${(-crop.y / crop.height) * 100}%`,
        }}
        muted
        preload="metadata"
        onLoadedMetadata={(e) => {
          const { videoWidth, videoHeight } = e.currentTarget;
          if (videoWidth > 0 && videoHeight > 0) {
            setVideoSize({ width: videoWidth, height: videoHeight });
          }
        }}
      />

      {/* Viewport rectangle */}
      <div
        className="absolute border border-white/60 bg-white/5 pointer-events-none"
        style={{
          left: `${vpLeft * 100}%`,
          top: `${vpTop * 100}%`,
          width: `${vpW * 100}%`,
          height: `${vpH * 100}%`,
        }}
      />

      {/* Crosshair dot */}
      <div
        className="absolute pointer-events-none"
        style={{ left: `${cx * 100}%`, top: `${cy * 100}%`, transform: 'translate(-50%, -50%)' }}
      >
        {/* Crosshair lines */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-3 bg-white/70" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-px bg-white/70" />
        {/* Centre dot */}
        <div className="w-2 h-2 rounded-full bg-white shadow-sm" style={{ margin: '-4px' }} />
      </div>
    </div>
  );
};
