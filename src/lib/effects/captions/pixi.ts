import { Container, Graphics, Text } from 'pixi.js';
import { useStore } from '../../../store';
import type { PixiEffect, PixiEffectUpdater } from '../../pixi/types';
import type { CaptionSegment, CaptionSettings } from '../../../types';

function findActiveSegment(segments: CaptionSegment[], t: number): CaptionSegment | null {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const seg = segments[mid];
    if (t < seg.start) {
      hi = mid - 1;
    } else if (t > seg.end) {
      lo = mid + 1;
    } else {
      return seg;
    }
  }
  return null;
}

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function styleKey(s: CaptionSettings): string {
  return `${s.fontFamily}|${s.fontScale}|${s.bold}|${s.italic}|${s.textColor}|${s.highlightColor}|${s.textOpacity}|${s.backgroundEnabled}|${s.backgroundColor}|${s.backgroundOpacity}|${s.backgroundRadius}|${s.position}`;
}

export const captionsPixiEffect: PixiEffect<null> = {
  id: 'captions',

  analyze() {
    return null;
  },

  setup(_data, _allData, scene): PixiEffectUpdater {
    const container = new Container();
    container.eventMode = 'none';
    container.visible = false;

    const background = new Graphics();
    background.eventMode = 'none';

    // Per-word text objects live in this container
    const wordContainer = new Container();
    wordContainer.eventMode = 'none';

    container.addChild(background, wordContainer);
    scene.overlayContainer.addChild(container);

    let lastText = '';
    let lastCanvasW = 0;
    let lastCanvasH = 0;
    let lastStyleKey = '';
    let lastActiveWordIdx = -2; // -2 = uninitialized sentinel

    // Cached layout so color-only updates skip geometry recalculation
    let cachedBgY = 0;
    let cachedBgH = 0;
    let cachedWordXOffsets: number[] = [];

    return (t) => {
      const { captions } = useStore.getState();
      if (!captions.captionsEnabled || captions.segments.length === 0) {
        container.visible = false;
        return;
      }

      const segment = findActiveSegment(captions.segments, t);
      if (!segment) {
        container.visible = false;
        lastActiveWordIdx = -2;
        return;
      }

      const canvasWidth = scene.app.renderer.width - 2 * scene.app.stage.x;
      const canvasHeight = scene.app.renderer.height - 2 * scene.app.stage.y;
      const fontSize = Math.round(
        Math.max(22, Math.min(canvasHeight * 0.045, 64)) * captions.fontScale,
      );
      const text = segment.text;
      const currentStyleKey = styleKey(captions);

      const layoutDirty =
        text !== lastText ||
        canvasWidth !== lastCanvasW ||
        canvasHeight !== lastCanvasH ||
        currentStyleKey !== lastStyleKey;

      if (layoutDirty) {
        const padX = Math.round(fontSize * 0.8);
        const padY = Math.round(fontSize * 0.45);
        const bottomMargin = Math.round(canvasHeight * 0.07);

        // Sync word Text pool size
        while (wordContainer.children.length > segment.words.length) {
          wordContainer.removeChildAt(wordContainer.children.length - 1);
        }
        while (wordContainer.children.length < segment.words.length) {
          const wt = new Text({ text: '', style: {} });
          wt.anchor.set(0, 0.5);
          wt.eventMode = 'none';
          wordContainer.addChild(wt);
        }

        // Apply typography and measure each word
        let totalWidth = 0;
        const wordWidths: number[] = [];

        segment.words.forEach((word, i) => {
          const wt = wordContainer.children[i] as Text;
          wt.style.fontSize = fontSize;
          wt.style.fontFamily = `${captions.fontFamily}, system-ui, ui-sans-serif, sans-serif`;
          wt.style.fontWeight = captions.bold ? '600' : '400';
          wt.style.fontStyle = captions.italic ? 'italic' : 'normal';
          // Trailing space on all but last word keeps inter-word spacing natural
          wt.text = i < segment.words.length - 1 ? `${word.word} ` : word.word;
          wordWidths.push(wt.width);
          totalWidth += wt.width;
        });

        const bgW = totalWidth + padX * 2;
        const bgH = Math.round(fontSize * 1.4) + padY * 2;
        const bgX = (canvasWidth - bgW) / 2;

        const bgY = (() => {
          if (captions.position === 'top') {
            return bottomMargin;
          }
          if (captions.position === 'center') {
            return (canvasHeight - bgH) / 2;
          }
          return canvasHeight - bgH - bottomMargin;
        })();

        // Cache layout for color-only updates
        cachedBgY = bgY;
        cachedBgH = bgH;
        cachedWordXOffsets = [];
        let wx = bgX + padX;
        wordWidths.forEach((w) => {
          cachedWordXOffsets.push(wx);
          wx += w;
        });

        // Draw background pill
        background.clear();
        if (captions.backgroundEnabled) {
          const radius = Math.min(captions.backgroundRadius, bgH / 2);
          background.roundRect(bgX, bgY, bgW, bgH, radius);
          background.fill({
            color: hexToNumber(captions.backgroundColor),
            alpha: captions.backgroundOpacity / 100,
          });
        }

        // Set word positions
        segment.words.forEach((_, i) => {
          const wt = wordContainer.children[i] as Text;
          wt.x = cachedWordXOffsets[i];
          wt.y = cachedBgY + cachedBgH / 2;
        });

        lastText = text;
        lastCanvasW = canvasWidth;
        lastCanvasH = canvasHeight;
        lastStyleKey = currentStyleKey;
        lastActiveWordIdx = -2; // force color refresh after layout rebuild
      }

      // Update word colors — only when the active word index changes
      const activeWordIdx = segment.words.findIndex((w) => t >= w.start && t <= w.end);

      if (activeWordIdx !== lastActiveWordIdx) {
        const baseAlpha = captions.textOpacity / 100;

        segment.words.forEach((_, i) => {
          if (i >= wordContainer.children.length) {
            return;
          }
          const wt = wordContainer.children[i] as Text;

          if (activeWordIdx === -1) {
            // No word currently active — all fully visible
            wt.style.fill = hexToNumber(captions.textColor);
            wt.alpha = baseAlpha;
          } else if (i === activeWordIdx) {
            wt.style.fill = hexToNumber(captions.highlightColor);
            wt.alpha = baseAlpha;
          } else if (i < activeWordIdx) {
            // Already spoken
            wt.style.fill = hexToNumber(captions.textColor);
            wt.alpha = baseAlpha;
          } else {
            // Not yet spoken
            wt.style.fill = hexToNumber(captions.textColor);
            wt.alpha = baseAlpha * 0.4;
          }
        });

        lastActiveWordIdx = activeWordIdx;
      }

      container.visible = true;
    };
  },
};
