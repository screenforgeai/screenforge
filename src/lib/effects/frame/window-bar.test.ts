import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME, getFrameGeometry, hasWindowBar, isCompactWindowBar } from './analyze';
import { WindowBarPainter } from './window-bar';
import type { FrameSettings } from './index';

const withBar = (style: 'none' | 'mac' | 'browser', aspectRatioId = '16:9'): FrameSettings => ({
  ...DEFAULT_FRAME,
  aspectRatioId,
  background: { ...DEFAULT_FRAME.background, padding: 0.2 },
  windowBar: { style, theme: 'light', center: 'url' },
});

describe('frame geometry with a window bar', () => {
  it('is unchanged without a bar', () => {
    const plain = getFrameGeometry({ ...DEFAULT_FRAME, aspectRatioId: '16:9' }, 1920, 1080);
    const none = getFrameGeometry(
      { ...withBar('none'), background: DEFAULT_FRAME.background },
      1920,
      1080,
    );
    expect(none.mediaRect).toEqual(plain.mediaRect);
    expect(none.windowRect).toEqual(plain.mediaRect);
    expect(none.barHeight).toBe(0);
  });
  it('puts bar + page in the padded area, page under the bar', () => {
    const g = getFrameGeometry(withBar('mac'), 1920, 1080);
    expect(g.barHeight).toBeGreaterThan(24);
    expect(g.windowRect.height).toBeCloseTo(g.mediaRect.height + g.barHeight);
    expect(g.mediaRect.y).toBeCloseTo(g.windowRect.y + g.barHeight);
    expect(g.windowRect.height).toBeLessThanOrEqual(g.contentRect.height + 0.01);
    expect(g.mediaRect.width / g.mediaRect.height).toBeCloseTo(1920 / 1080);
  });
  it('flags the compact bar for 9:16', () => {
    expect(isCompactWindowBar(withBar('mac', '9:16'))).toBe(true);
    expect(hasWindowBar(withBar('none'))).toBe(false);
  });
});

describe('WindowBarPainter', () => {
  const geometry = { windowRect: { x: 0, y: 0, width: 1280, height: 836 }, barHeight: 36 };
  const frame = {
    ...withBar('mac'),
    windowBar: { style: 'mac' as const, theme: 'auto' as const, center: 'url' as const },
  };
  it('decides auto once, from the first readable frame', () => {
    const painter = new WindowBarPainter();
    let samples = 0;
    const dark = () => {
      samples++;
      return 0.1;
    };
    const first = painter.sceneAt(frame, geometry, 0, {}, () => null);
    expect(first?.ops[0]).toMatchObject({ fill: '#F2F3F5' });
    painter.sceneAt(frame, geometry, 0, {}, dark);
    const later = painter.sceneAt(frame, geometry, 5, {}, () => 0.9);
    expect(later?.ops[0]).toMatchObject({ fill: '#2B2D32' });
    expect(samples).toBe(1);
  });
  it('follows the page visits', () => {
    const painter = new WindowBarPainter();
    const visits = [
      { t: 0, url: 'https://a.com/one' },
      { t: 3, url: 'https://a.com/two' },
    ];
    const at = (t: number) =>
      painter
        .sceneAt(frame, geometry, t, { pageVisits: visits, windowBarTheme: 'light' }, () => null)!
        .ops.filter((op) => op.kind === 'text')
        .map((op) => op.kind === 'text' && op.text);
    expect(at(1)).toEqual(['a.com/one']);
    expect(at(4)).toEqual(['a.com/two']);
  });
});
