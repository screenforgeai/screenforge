import { useEffect, useRef, useState } from 'react';
import type { BackgroundSettings } from 'src/lib/effects/frame';
import { frameBackgroundCss } from 'src/lib/effects/frame/backgroundCss';
import {
  AUTO_THEME_SAMPLE_ROWS,
  drawWindowBar,
  layoutWindowBar,
  resolveWindowBarTheme,
  topBandBrightness,
  type ResolvedWindowBarTheme,
  type WindowBarPage,
  type WindowBarSettings,
} from 'src/lib/window-bar';

/**
 * Light or dark for an 'auto' bar, from the still's top rows as they show
 * under the bar: from `cropTop` (a share of the still's height) down, as the
 * export decides it.
 */
function useAutoTheme(still: string | null, cropTop: number): ResolvedWindowBarTheme {
  const [theme, setTheme] = useState<ResolvedWindowBarTheme>('light');
  useEffect(() => {
    if (!still) {
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(256, image.naturalWidth);
      canvas.height = AUTO_THEME_SAMPLE_ROWS;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx || cancelled) {
        return;
      }
      const top = Math.round(Math.min(Math.max(cropTop, 0), 1) * image.naturalHeight);
      const rows = Math.max(1, Math.min(AUTO_THEME_SAMPLE_ROWS, image.naturalHeight - top));
      ctx.drawImage(
        image,
        0,
        Math.min(top, image.naturalHeight - rows),
        image.naturalWidth,
        rows,
        0,
        0,
        canvas.width,
        AUTO_THEME_SAMPLE_ROWS,
      );
      const { data } = ctx.getImageData(0, 0, canvas.width, AUTO_THEME_SAMPLE_ROWS);
      setTheme(
        resolveWindowBarTheme(
          'auto',
          topBandBrightness(data, canvas.width, AUTO_THEME_SAMPLE_ROWS),
        ),
      );
    };
    image.src = still;
    return () => {
      cancelled = true;
    };
  }, [still, cropTop]);
  return theme;
}

/**
 * A hover card's stage for one window bar style: the frame's background, and
 * a small window with the bar (drawn by the same window-bar renderer as the
 * video) over a still of the recording. `cropTop` is the share of the still's
 * height the recorded toolbar crop takes off the top; `page` is what an
 * address or title bar reads, as in the output.
 */
export const WindowBarPreviewStage = ({
  settings,
  background,
  still,
  cropTop = 0,
  page = null,
}: {
  settings: WindowBarSettings;
  background: BackgroundSettings;
  still: string | null;
  cropTop?: number;
  page?: WindowBarPage | null;
}) => {
  const barRef = useRef<HTMLCanvasElement>(null);
  const autoTheme = useAutoTheme(still, cropTop);
  const theme = settings.theme === 'auto' ? autoTheme : settings.theme;
  const backdrop = frameBackgroundCss(background);

  useEffect(() => {
    const canvas = barRef.current;
    const width = canvas?.parentElement?.clientWidth ?? 0;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || width <= 0) {
      return;
    }
    const scene = layoutWindowBar({ settings, theme, width, page });
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(scene.width * ratio);
    canvas.height = Math.round(scene.height * ratio);
    canvas.style.height = `${scene.height}px`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawWindowBar(ctx, scene, 0, 0, ratio);
  }, [settings, theme, page]);

  return (
    <div
      className="relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden border-b border-sf-border bg-[#3e3e46]"
      style={{ background: backdrop ?? undefined }}
      aria-hidden
    >
      <div className="relative w-[82%] overflow-hidden rounded-[6px] bg-[#1b1b20] shadow-[0_14px_30px_rgba(0,0,0,0.45)] ring-1 ring-black/25">
        {settings.style !== 'none' && <canvas ref={barRef} className="block w-full" />}
        <div className="relative aspect-video w-full overflow-hidden">
          {still ? (
            <img
              src={still}
              alt=""
              className="absolute left-0 w-full"
              style={{
                top: `${(-cropTop / Math.max(1 - cropTop, 0.01)) * 100}%`,
                height: `${100 / Math.max(1 - cropTop, 0.01)}%`,
              }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col gap-1.5 p-3">
              <div className="h-1.5 w-1/3 rounded-full bg-white/15" />
              <div className="h-1.5 w-1/2 rounded-full bg-white/10" />
              <div className="mt-auto h-8 w-full rounded bg-white/5" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
