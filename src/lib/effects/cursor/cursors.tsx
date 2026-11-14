import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import type { CursorType } from '../../../types';
import {
  CURSOR_STYLE_IDS,
  drawCursorStyle,
  getCursorStyleExtent,
  isNameTagCursorStyle,
  type CursorDrawOptions,
  type CursorStyleId,
  type VectorCursorStyleId,
} from './styles';
import cursorDefault01Url from '../../../assets/cursors/cursor-default-01.svg';
import cursorPointer01Url from '../../../assets/cursors/cursor-pointer-01.svg';
import cursorText01Url from '../../../assets/cursors/cursor-text-01.svg';

export const CURSOR_PREVIEW_STATES = ['default', 'pointer', 'text'] as const;
export type CursorStyleState = (typeof CURSOR_PREVIEW_STATES)[number];

type PreviewProps = {
  className?: string;
  /** Colour for the name-tag styles, so their tile matches the chosen colour. */
  color?: string;
};

type CursorStateDefinition = {
  Preview: ComponentType<PreviewProps>;
  draw: (
    ctx: CanvasRenderingContext2D,
    pressed: boolean,
    options?: Partial<CursorDrawOptions>,
  ) => void;
};

export type CursorStyleDefinition = {
  states: Record<CursorStyleState, CursorStateDefinition>;
};

const CURSOR_ASSET_SIZE = 32;
const CURSOR_DRAW_SIZE = 52;

type CursorAsset = {
  url: string;
  hotspot: { x: number; y: number };
};

const DEFAULT_CURSOR_ASSET: CursorAsset = {
  url: cursorDefault01Url,
  hotspot: { x: 10, y: 2 },
};

const POINTER_CURSOR_ASSET: CursorAsset = {
  url: cursorPointer01Url,
  hotspot: { x: 10, y: 2 },
};

const TEXT_CURSOR_ASSET: CursorAsset = {
  url: cursorText01Url,
  hotspot: { x: 13, y: 13 },
};

/**
 * Returns the draw-space hotspot offset (in pixels at CURSOR_DRAW_SIZE scale) for a
 * given cursor style state. Used by the renderer to compensate for different visual
 * extents when crossfading between cursor types, preventing apparent position jumps.
 */
export function getCursorDrawHotspot(
  _style: string,
  state: CursorStyleState,
): { x: number; y: number } {
  const scale = CURSOR_DRAW_SIZE / CURSOR_ASSET_SIZE;
  let hotspot: { x: number; y: number };
  switch (state) {
    case 'text':
      hotspot = TEXT_CURSOR_ASSET.hotspot;
      break;
    default:
      hotspot = DEFAULT_CURSOR_ASSET.hotspot;
      break;
  }
  return { x: hotspot.x * scale, y: hotspot.y * scale };
}

const cursorImageCache = new Map<string, HTMLImageElement>();

function getCursorImage(url: string): HTMLImageElement {
  const existing = cursorImageCache.get(url);
  if (existing) {
    return existing;
  }
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  cursorImageCache.set(url, img);
  return img;
}

function drawCursorAsset(
  ctx: CanvasRenderingContext2D,
  asset: CursorAsset,
  pressed: boolean,
): void {
  void pressed;
  const img = getCursorImage(asset.url);
  if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return;
  }
  const size = CURSOR_DRAW_SIZE;
  const hotspotX = (asset.hotspot.x / CURSOR_ASSET_SIZE) * size;
  const hotspotY = (asset.hotspot.y / CURSOR_ASSET_SIZE) * size;
  ctx.drawImage(img, -hotspotX, -hotspotY, size, size);
}

// Warm cache so the first rendered cursor frame uses the updated SVGs immediately.
getCursorImage(DEFAULT_CURSOR_ASSET.url);
getCursorImage(POINTER_CURSOR_ASSET.url);
getCursorImage(TEXT_CURSOR_ASSET.url);

/* previews */

const PreviewCursorDefault01 = ({ className }: PreviewProps) => (
  <img src={cursorDefault01Url} alt="" aria-hidden className={className} draggable={false} />
);

const PreviewCursorPointer01 = ({ className }: PreviewProps) => (
  <img src={cursorPointer01Url} alt="" aria-hidden className={className} draggable={false} />
);

const PreviewCursorText01 = ({ className }: PreviewProps) => (
  <img src={cursorText01Url} alt="" aria-hidden className={className} draggable={false} />
);

/**
 * A vector style's preview: the cursor drawn into a small canvas, fitted to its
 * box. Static (no twinkle) — it only has to be recognisable in a list.
 */
const VectorCursorPreview = ({
  style,
  state,
  className,
  color,
}: PreviewProps & { style: VectorCursorStyleId; state: CursorStyleState }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }
    const box = canvas.getBoundingClientRect();
    const size = Math.max(box.width, box.height, 16);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    // Fit the cursor itself (not its name tag) so every style reads at the same size.
    const extent = getCursorStyleExtent(style, state, isNameTagCursorStyle(style) ? '' : undefined);
    const w = extent.right - extent.left;
    const h = extent.bottom - extent.top;
    const scale = (size * dpr) / Math.max(w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      (size * dpr - w * scale) / 2 - extent.left * scale,
      (size * dpr - h * scale) / 2 - extent.top * scale,
    );
    drawCursorStyle(ctx, style, state, { label: '', ...(color ? { color } : {}) });
  }, [style, state, color]);
  return <canvas ref={ref} aria-hidden className={className} />;
};

const vectorStyle = (style: VectorCursorStyleId): CursorStyleDefinition => {
  const state = (s: CursorStyleState): CursorStateDefinition => ({
    Preview: (props: PreviewProps) => (
      <VectorCursorPreview
        style={style}
        state={s}
        className={props.className}
        color={props.color}
      />
    ),
    draw: (ctx, pressed, options) => drawCursorStyle(ctx, style, s, { ...options, pressed }),
  });
  return { states: { default: state('default'), pointer: state('pointer'), text: state('text') } };
};

/* registry */

const CURSOR01: CursorStyleDefinition = {
  states: {
    default: {
      Preview: PreviewCursorDefault01,
      draw: (ctx, pressed) => drawCursorAsset(ctx, DEFAULT_CURSOR_ASSET, pressed),
    },
    pointer: {
      Preview: PreviewCursorPointer01,
      draw: (ctx, pressed) => drawCursorAsset(ctx, POINTER_CURSOR_ASSET, pressed),
    },
    text: {
      Preview: PreviewCursorText01,
      draw: (ctx, pressed) => drawCursorAsset(ctx, TEXT_CURSOR_ASSET, pressed),
    },
  },
};

export const CURSOR_REGISTRY: Record<CursorStyleId, CursorStyleDefinition> = Object.fromEntries(
  CURSOR_STYLE_IDS.map((id) => [id, id === 'cursor01' ? CURSOR01 : vectorStyle(id)]),
) as Record<CursorStyleId, CursorStyleDefinition>;

export type CursorStyle = CursorStyleId;

const CURSOR_REGISTRY_LOOKUP = CURSOR_REGISTRY as Record<string, CursorStyleDefinition>;

export function resolveCursorStyle(style: string): CursorStyleDefinition {
  return CURSOR_REGISTRY_LOOKUP[style] ?? CURSOR_REGISTRY.cursor01;
}

export function resolveCursorStyleState(cursorType: CursorType): CursorStyleState {
  if (cursorType === 'pointer') {
    return 'pointer';
  }
  if (cursorType === 'text') {
    return 'text';
  }
  return 'default';
}

export function isCursorStyleStateType(cursorType: CursorType): cursorType is CursorStyleState {
  return cursorType === 'default' || cursorType === 'pointer' || cursorType === 'text';
}
