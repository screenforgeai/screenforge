import { Container, Graphics, Text } from 'pixi.js';
import { DropShadowFilter } from 'pixi-filters';
import { useStore } from '../../../store';
import type { PixiEffect, PixiEffectUpdater } from '../../pixi/types';
import { analyzeKeyboardData, resolveKeyboardCaptionState, type KeyboardData } from './analyze';
import { isKeyboardPreviewActive } from './preview';
import { resolveKeyboardCaptionPalette, resolveKeyboardCaptionSize } from './style';
import type { ProjectKeyboardSettings } from '../../../types';

const PREVIEW_KEYS = ['⌘', 'K'];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function transcriptionCaptionBump(canvasHeight: number): number {
  const fontSize = Math.round(Math.max(18, Math.min(canvasHeight * 0.035, 48)));
  const padY = Math.round(fontSize * 0.45);
  const bgH = Math.round(fontSize * 1.4) + padY * 2;
  const gap = Math.round(clamp(canvasHeight * 0.015, 8, 20));
  return bgH + gap;
}

interface CaptionLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  keyGap: number;
  outerPadX: number;
  outerPadY: number;
  fontSize: number;
  keyWidths: number[];
}

function clearContainer(container: Container): void {
  for (const child of container.removeChildren()) {
    child.destroy();
  }
}

function createKeyText(key: string, fontSize: number): Text {
  const text = new Text({
    text: key,
    style: {
      fill: 0xffffff,
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize,
      fontWeight: '600',
    },
  });
  text.anchor.set(0.5);
  text.eventMode = 'none';
  return text;
}

function resolveLayout(
  keys: string[],
  canvasWidth: number,
  canvasHeight: number,
  keyTexts: Text[],
  keyboard: ProjectKeyboardSettings,
  captionsActive: boolean,
): CaptionLayout {
  const fontSize = clamp(canvasHeight * 0.03 * resolveKeyboardCaptionSize(keyboard.size), 16, 42);
  const keyGap = Math.round(clamp(fontSize * 0.45, 6, 12));
  const outerPadX = Math.round(clamp(fontSize * 0.9, 18, 32));
  const outerPadY = Math.round(clamp(fontSize * 0.55, 10, 18));
  const keyWidths = keys.map((_, index) => Math.ceil(keyTexts[index]?.width ?? fontSize));
  const keysWidth =
    keyWidths.reduce((sum, width) => sum + width, 0) + keyGap * Math.max(0, keyWidths.length - 1);
  const width = keysWidth + outerPadX * 2;
  const height = Math.round(fontSize * 1.35) + outerPadY * 2;
  const x = (canvasWidth - width) / 2;
  const bump = captionsActive ? transcriptionCaptionBump(canvasHeight) : 0;
  const y = canvasHeight - height - clamp(canvasHeight * 0.06, 28, 72) - bump;

  return {
    x,
    y,
    width,
    height,
    centerX: x + width / 2,
    centerY: y + height / 2,
    keyGap,
    outerPadX,
    outerPadY,
    fontSize,
    keyWidths,
  };
}

function drawCaption(
  graphics: Graphics,
  keys: string[],
  layout: CaptionLayout,
  keyTexts: Text[],
  keyboard: ProjectKeyboardSettings,
): void {
  const palette = resolveKeyboardCaptionPalette(keyboard.background);
  graphics.clear();
  graphics.roundRect(layout.x, layout.y, layout.width, layout.height, 12);
  graphics.fill({ color: palette.panelColor, alpha: palette.panelAlpha });
  graphics.roundRect(layout.x, layout.y, layout.width, layout.height, 12);
  graphics.stroke({
    color: palette.panelBorderColor,
    alpha: palette.panelBorderAlpha,
    width: 1,
  });

  let keyX = layout.x + layout.outerPadX;
  keys.forEach((_, index) => {
    const width = layout.keyWidths[index];
    const text = keyTexts[index];
    if (text) {
      text.x = keyX + width / 2;
      text.y = layout.centerY;
      text.style.fill = palette.textColor;
    }
    keyX += width + (index < keys.length - 1 ? layout.keyGap : 0);
  });
}

export const keyboardPixiEffect: PixiEffect<KeyboardData> = {
  id: 'keyboard',

  analyze(recording) {
    return analyzeKeyboardData(recording);
  },

  setup(data, _allData, scene): PixiEffectUpdater {
    const container = new Container();
    container.eventMode = 'none';
    container.visible = false;

    const graphics = new Graphics();
    graphics.eventMode = 'none';

    const textLayer = new Container();
    textLayer.eventMode = 'none';

    const dropShadow = new DropShadowFilter();
    dropShadow.color = 0x000000;
    dropShadow.alpha = 0.22;
    dropShadow.blur = 18;
    dropShadow.offset = { x: 0, y: 8 };
    container.filters = [dropShadow];

    container.addChild(graphics, textLayer);
    scene.overlayContainer.addChild(container);

    let keySignature = '';
    let layoutSignature = '';
    let lastBackgroundKey = '';
    let keyTexts: Text[] = [];

    return (t) => {
      const { keyboard, captions } = useStore.getState();
      if (!keyboard.enabled) {
        container.visible = false;
        return;
      }

      const captionsActive = captions.captionsEnabled && captions.segments.length > 0;

      const isPreview = isKeyboardPreviewActive();

      let keys: string[];
      let opacity: number;
      let scale: number;

      if (isPreview) {
        keys = PREVIEW_KEYS;
        opacity = 1;
        scale = 1;
      } else {
        if (data.comboEvents.length === 0) {
          container.visible = false;
          return;
        }
        const caption = resolveKeyboardCaptionState(data.comboEvents, t);
        if (!caption.visible || caption.keys.length === 0) {
          container.visible = false;
          return;
        }
        keys = caption.keys;
        opacity = caption.opacity;
        scale = caption.scale;
      }

      const canvasWidth = scene.app.renderer.width - 2 * scene.app.stage.x;
      const canvasHeight = scene.app.renderer.height - 2 * scene.app.stage.y;
      const nextKeySignature = keys.join('\u0001');
      const fontSize = clamp(
        canvasHeight * 0.03 * resolveKeyboardCaptionSize(keyboard.size),
        16,
        42,
      );
      const nextLayoutSignature = [
        canvasWidth,
        canvasHeight,
        fontSize,
        keyboard.size,
        captionsActive,
      ].join(':');

      if (nextKeySignature !== keySignature || nextLayoutSignature !== layoutSignature) {
        clearContainer(textLayer);
        keyTexts = keys.map((key) => createKeyText(key, fontSize));
        textLayer.addChild(...keyTexts);
        keySignature = nextKeySignature;
        layoutSignature = nextLayoutSignature;
      }

      const palette = resolveKeyboardCaptionPalette(keyboard.background);
      // Only update the DropShadowFilter when the palette changes — each property
      // write dirties the filter's internal shader state and forces a multi-pass re-execution.
      if (keyboard.background !== lastBackgroundKey) {
        dropShadow.color = palette.shadowColor;
        dropShadow.alpha = palette.shadowAlpha;
        dropShadow.blur = palette.shadowBlur;
        dropShadow.offset = { x: 0, y: palette.shadowDistance };
        lastBackgroundKey = keyboard.background;
      }

      const layout = resolveLayout(
        keys,
        canvasWidth,
        canvasHeight,
        keyTexts,
        keyboard,
        captionsActive,
      );
      drawCaption(graphics, keys, layout, keyTexts, keyboard);

      container.visible = true;
      container.alpha = clamp(opacity * keyboard.opacity, 0, 1);
      container.pivot.set(layout.centerX, layout.centerY);
      container.position.set(layout.centerX, layout.centerY);
      container.scale.set(scale);
    };
  },
};
