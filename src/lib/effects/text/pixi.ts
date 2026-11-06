import { Container, Graphics, Text } from 'pixi.js';
import { useStore } from '../../../store';
import type { PixiEffect, PixiEffectUpdater, PixiScene } from '../../pixi/types';
import type { TextClip } from '../../../types';
import { fontStack } from '../../fonts';

const REFERENCE_HEIGHT = 1080;

function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function computeAlpha(clip: TextClip, t: number): number {
  let alphaIn = 1;
  let alphaOut = 1;

  if (clip.animationIn !== 'none') {
    alphaIn = Math.min(1, (t - clip.start) / Math.max(clip.animationInDuration, 0.001));
  }
  if (clip.animationOut !== 'none') {
    alphaOut = Math.min(1, (clip.end - t) / Math.max(clip.animationOutDuration, 0.001));
  }

  return Math.min(alphaIn, alphaOut);
}

function computeSlideOffset(clip: TextClip, alpha: number, scale: number): number {
  const isSlide =
    clip.animationIn === 'slide-up' ||
    clip.animationIn === 'slide-down' ||
    clip.animationOut === 'slide-up' ||
    clip.animationOut === 'slide-down';
  if (!isSlide) {
    return 0;
  }
  const direction = clip.animationIn === 'slide-up' || clip.animationOut === 'slide-up' ? 1 : -1;
  return direction * (1 - alpha) * 20 * scale;
}

let _sharedCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!_sharedCtx) {
    const canvas = document.createElement('canvas');
    _sharedCtx = canvas.getContext('2d');
  }
  return _sharedCtx;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
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
  return lines;
}

interface ClipNode {
  container: Container;
  bg: Graphics;
  label: Text;
  ul: Graphics;
}

export const textPixiEffect: PixiEffect<null> = {
  id: 'text',

  analyze() {
    return null;
  },

  setup(_data, _allData, scene: PixiScene): PixiEffectUpdater {
    const root = new Container();
    root.eventMode = 'none';
    scene.overlayContainer.addChild(root);

    const nodes = new Map<string, ClipNode>();

    return (t) => {
      const { textClips } = useStore.getState();

      const canvasWidth = scene.app.renderer.width - 2 * scene.app.stage.x;
      const canvasHeight = scene.app.renderer.height - 2 * scene.app.stage.y;
      const scale = canvasHeight / REFERENCE_HEIGHT;

      const activeIds = new Set(
        textClips.filter((c) => t >= c.start && t <= c.end).map((c) => c.id),
      );

      // Destroy nodes for clips that no longer exist at all
      for (const [id, node] of nodes) {
        if (!textClips.some((c) => c.id === id)) {
          root.removeChild(node.container);
          node.container.destroy({ children: true });
          nodes.delete(id);
        }
      }

      for (const clip of textClips) {
        if (!activeIds.has(clip.id)) {
          const node = nodes.get(clip.id);
          if (node) {
            node.container.visible = false;
          }
          continue;
        }

        const alpha = computeAlpha(clip, t);
        const slideOffset = computeSlideOffset(clip, alpha, scale);
        const fontSize = Math.round(clip.fontSize * scale);

        let node = nodes.get(clip.id);
        if (!node) {
          const container = new Container();
          container.eventMode = 'none';
          const bg = new Graphics();
          bg.eventMode = 'none';
          const label = new Text({ text: '', style: { fill: 0xffffff, fontSize } });
          label.eventMode = 'none';
          const ul = new Graphics();
          ul.eventMode = 'none';
          container.addChild(bg, label, ul);
          root.addChild(container);
          node = { container, bg, label, ul };
          nodes.set(clip.id, node);
        }

        const { container, bg, label, ul } = node;
        container.visible = true;
        container.alpha = alpha;

        // Update text style
        label.style.fontSize = fontSize;
        label.style.fontFamily = fontStack(clip.fontFamily);
        label.style.fontWeight = clip.bold ? 'bold' : 'normal';
        label.style.fontStyle = clip.italic ? 'italic' : 'normal';
        label.style.fill = { color: hexToNumber(clip.color), alpha: clip.colorOpacity / 100 };
        label.style.align = clip.align;
        label.style.wordWrap = true;
        label.style.wordWrapWidth = clip.width * canvasWidth;
        label.style.lineHeight = Math.round(fontSize * 1.35);
        label.text = clip.content;

        const originX = clip.x * canvasWidth;
        const originY = clip.y * canvasHeight + slideOffset;

        const pad = Math.round(clip.backgroundPadding * scale);
        const radius = Math.round(clip.backgroundRadius * scale);
        const bgW = clip.width * canvasWidth + pad * 2;
        const bgH = clip.height !== undefined ? clip.height * canvasHeight : label.height + pad * 2;
        const bgX = originX - pad;

        const innerH = bgH - pad * 2;
        const va = clip.verticalAlign ?? 'top';
        const textOffsetY =
          va === 'middle'
            ? (innerH - label.height) / 2
            : va === 'bottom'
              ? innerH - label.height
              : 0;
        const textStartY = originY + textOffsetY;

        label.x =
          clip.align === 'center'
            ? originX + (clip.width * canvasWidth) / 2
            : clip.align === 'right'
              ? originX + clip.width * canvasWidth
              : originX;
        label.y = textStartY;
        label.anchor.x = clip.align === 'center' ? 0.5 : clip.align === 'right' ? 1 : 0;
        label.anchor.y = 0;

        bg.clear();
        bg.roundRect(bgX, originY - pad, bgW, bgH, radius);
        bg.fill({
          color: hexToNumber(clip.backgroundColor),
          alpha: clip.backgroundOpacity / 100,
        });

        ul.clear();
        if (clip.underline) {
          const mCtx = getMeasureCtx();
          if (mCtx) {
            const fontStyle = [
              clip.italic ? 'italic' : '',
              clip.bold ? 'bold' : '',
              `${fontSize}px`,
              fontStack(clip.fontFamily),
            ]
              .filter(Boolean)
              .join(' ');
            mCtx.font = fontStyle;

            const maxWidth = clip.width * canvasWidth;
            const lineHeight = fontSize * 1.35;
            const lines = wrapLines(mCtx, clip.content, maxWidth);
            const decorH = Math.max(1, Math.round(fontSize * 0.07));
            const decorColor = hexToNumber(clip.color);
            const decorAlpha = clip.colorOpacity / 100;

            for (let i = 0; i < lines.length; i++) {
              const lineWidth = mCtx.measureText(lines[i]).width;
              const lineY = textStartY + i * lineHeight;
              const decorX =
                clip.align === 'center'
                  ? label.x - lineWidth / 2
                  : clip.align === 'right'
                    ? label.x - lineWidth
                    : label.x;

              ul.rect(decorX, lineY + fontSize + 1, lineWidth, decorH);
              ul.fill({ color: decorColor, alpha: decorAlpha });
            }
          }
        }
      }
    };
  },
};
