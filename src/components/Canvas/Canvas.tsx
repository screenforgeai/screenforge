import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { CanvasPreview } from './_components/CanvasPreview';
import { CanvasTimeline } from './_components/CanvasTimeline';

export const Canvas = ({
  videoRef,
  canvasRef,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = useState(0);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }

    const update = () => setAvailableHeight(node.clientHeight);
    update();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      setAvailableHeight(entry.contentRect.height);
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <CanvasPreview videoRef={videoRef} canvasRef={canvasRef} />
      <CanvasTimeline videoRef={videoRef} availableHeight={availableHeight} />
    </div>
  );
};
