import { useState, useRef, useCallback, useEffect } from 'react';

interface Options {
  min: number;
  max: number;
  initial: number;
}

export function useResizable({ min, max, initial }: Options) {
  const initialHeight = Math.max(min, Math.min(max, initial));
  const [height, setHeight] = useState(initialHeight);
  const heightRef = useRef(initialHeight);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = heightRef.current;

      const onMove = (ev: MouseEvent) => {
        const newH = Math.max(min, Math.min(max, startH - (ev.clientY - startY)));
        heightRef.current = newH;
        setHeight(newH);
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [min, max],
  );

  useEffect(() => {
    const next = Math.max(min, Math.min(max, heightRef.current));
    if (next === heightRef.current) {
      return;
    }

    heightRef.current = next;
    setHeight(next);
  }, [min, max]);

  return { height, onMouseDown };
}
