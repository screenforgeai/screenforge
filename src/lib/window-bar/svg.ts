import type { WindowBarOp, WindowBarScene } from './layout';
import { WINDOW_BAR_FONT, WINDOW_BAR_FONT_WEIGHT } from './tokens';

const n = (value: number): string => String(+value.toFixed(3));

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function opSvg(op: WindowBarOp): string {
  switch (op.kind) {
    case 'rect': {
      let out = `<rect x="${n(op.x)}" y="${n(op.y)}" width="${n(op.w)}" height="${n(op.h)}" rx="${n(op.r)}" fill="${op.fill}"/>`;
      if (op.stroke && op.strokeWidth) {
        const inset = op.strokeWidth / 2;
        out +=
          `<rect x="${n(op.x + inset)}" y="${n(op.y + inset)}" width="${n(op.w - op.strokeWidth)}" ` +
          `height="${n(op.h - op.strokeWidth)}" rx="${n(Math.max(0, op.r - inset))}" fill="none" ` +
          `stroke="${op.stroke}" stroke-width="${n(op.strokeWidth)}"/>`;
      }
      return out;
    }
    case 'circle': {
      let out = `<circle cx="${n(op.cx)}" cy="${n(op.cy)}" r="${n(op.r)}" fill="${op.fill}"/>`;
      if (op.stroke && op.strokeWidth) {
        out +=
          `<circle cx="${n(op.cx)}" cy="${n(op.cy)}" r="${n(op.r - op.strokeWidth / 2)}" fill="none" ` +
          `stroke="${op.stroke}" stroke-width="${n(op.strokeWidth)}"/>`;
      }
      return out;
    }
    case 'icon':
      return (
        `<path d="${op.d}" transform="translate(${n(op.x)} ${n(op.y)}) scale(${n(op.size / op.box)})" ` +
        `fill="none" stroke="${op.color}" stroke-width="${n(op.strokeWidth)}" ` +
        `stroke-linecap="round" stroke-linejoin="round" opacity="${n(op.alpha)}"/>`
      );
    case 'text':
      return (
        `<text x="${n(op.x)}" y="${n(op.y)}" font-family="${escapeXml(WINDOW_BAR_FONT)}" ` +
        `font-weight="${WINDOW_BAR_FONT_WEIGHT}" font-size="${n(op.size)}" fill="${op.color}" ` +
        `text-anchor="${op.align === 'center' ? 'middle' : 'start'}" opacity="${n(op.alpha)}" ` +
        `xml:space="preserve">${escapeXml(op.text)}</text>`
      );
  }
}

/** The bar's shapes as SVG elements, in layout units, for composing into a larger SVG. */
export function windowBarSvgElements(scene: WindowBarScene): string {
  return scene.ops.map(opSvg).join('');
}

/** A standalone SVG of the bar, `pixelRatio` pixels per layout unit (2 for captures). */
export function windowBarSvg(scene: WindowBarScene, pixelRatio = 1): string {
  const w = scene.width * pixelRatio;
  const h = scene.height * pixelRatio;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" ` +
    `viewBox="0 0 ${n(scene.width)} ${n(scene.height)}">${windowBarSvgElements(scene)}</svg>`
  );
}
