import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_BAR,
  ELLIPSIS,
  centerText,
  fitAddress,
  fitEnd,
  fitWindowWithBar,
  layoutWindowBar,
  measureText,
  normalizePageVisits,
  pageAtTime,
  resolveWindowBarTheme,
  showsLock,
  splitUrl,
  topBandBrightness,
  windowBarHeight,
  windowBarSvg,
  type WindowBarOp,
  type WindowBarSettings,
} from './index';

const mac: WindowBarSettings = { style: 'mac', theme: 'light', center: 'url' };
const page = { url: 'https://app.example.com/projects/q3-launch?tab=1', title: 'Q3 launch' };
const texts = (ops: WindowBarOp[]) =>
  ops.filter((op): op is Extract<WindowBarOp, { kind: 'text' }> => op.kind === 'text');

describe('defaults', () => {
  it('leaves existing presets without a bar', () => {
    expect(DEFAULT_WINDOW_BAR.style).toBe('none');
    expect(
      layoutWindowBar({ settings: DEFAULT_WINDOW_BAR, theme: 'light', width: 1280 }).height,
    ).toBe(0);
  });
});

describe('windowBarHeight', () => {
  it('uses the spec heights at 1280px', () => {
    expect(windowBarHeight('mac', 1280)).toBe(36);
    expect(windowBarHeight('windows', 1280)).toBe(36);
    expect(windowBarHeight('browser', 1280)).toBe(40);
  });
  it('scales with width and clamps to 24–72', () => {
    expect(windowBarHeight('mac', 1920)).toBe(54);
    expect(windowBarHeight('mac', 400)).toBe(24);
    expect(windowBarHeight('browser', 5000)).toBe(72);
    expect(windowBarHeight('none', 1280)).toBe(0);
  });
});

describe('center text', () => {
  it('reads the address without scheme, www, query or trailing slash', () => {
    expect(splitUrl('https://www.app.example.com/projects/?a=1#x')).toEqual({
      host: 'app.example.com',
      address: 'app.example.com/projects',
    });
    expect(splitUrl('about:blank')).toEqual({ host: '', address: '' });
  });
  it('follows the center setting', () => {
    expect(centerText({ ...mac, center: 'url' }, page)).toBe('app.example.com/projects/q3-launch');
    expect(centerText({ ...mac, center: 'domain' }, page)).toBe('app.example.com');
    expect(centerText({ ...mac, center: 'title' }, page)).toBe('Q3 launch');
    expect(centerText({ ...mac, center: 'title' }, { url: page.url })).toBe('app.example.com');
    expect(centerText({ ...mac, center: 'custom', customText: ' Acme ' }, page)).toBe('Acme');
    expect(centerText({ ...mac, center: 'none' }, page)).toBe('');
  });
  it('shows the lock for an address, never on Windows', () => {
    expect(showsLock({ ...mac, center: 'url' })).toBe(true);
    expect(showsLock({ ...mac, center: 'domain' })).toBe(true);
    expect(showsLock({ ...mac, center: 'title' })).toBe(false);
    expect(showsLock({ ...mac, style: 'windows', center: 'url' })).toBe(false);
  });
});

describe('text fitting', () => {
  it('measures Inter 500', () => {
    expect(measureText('app.example.com', 12)).toBeCloseTo(102.2, 0);
  });
  it('cuts an address to domain/…/last-segment', () => {
    const long = 'app.example.com/workspaces/acme/projects/q3-launch';
    const room = measureText(`app.example.com/${ELLIPSIS}/q3-launch`, 12) + 1;
    expect(fitAddress(long, room, 12)).toBe(`app.example.com/${ELLIPSIS}/q3-launch`);
  });
  it('cuts from the middle when even that is too long', () => {
    const out = fitAddress('app.example.com/workspaces/acme/projects/q3-launch', 60, 12);
    expect(out).toContain(ELLIPSIS);
    expect(out.startsWith('app')).toBe(true);
    expect(out.endsWith('h')).toBe(true);
    expect(measureText(out, 12)).toBeLessThanOrEqual(60);
  });
  it('cuts a title at the end', () => {
    const out = fitEnd('Quarterly revenue overview for the whole team', 80, 12);
    expect(out.endsWith(ELLIPSIS)).toBe(true);
    expect(measureText(out, 12)).toBeLessThanOrEqual(80);
  });
});

describe('layoutWindowBar', () => {
  it('draws the Mac dots at 12/8/14 with an 18% inner edge', () => {
    const scene = layoutWindowBar({ settings: mac, theme: 'light', width: 1280, page });
    const dots = scene.ops.filter((op) => op.kind === 'circle');
    expect(dots.map((d) => d.kind === 'circle' && [d.cx, d.r, d.fill])).toEqual([
      [20, 6, '#FF5F57'],
      [40, 6, '#FEBC2E'],
      [60, 6, '#28C840'],
    ]);
    expect(dots[0]).toMatchObject({ stroke: 'rgba(0,0,0,0.18)', strokeWidth: 0.5 });
  });
  it('puts a fixed 44% address box in the middle, with the lock and the address', () => {
    const scene = layoutWindowBar({ settings: mac, theme: 'light', width: 1280, page });
    const box = scene.ops.find((op) => op.kind === 'rect' && op.r === 6);
    expect(box).toMatchObject({
      x: 358.4,
      w: 563.2,
      h: 24,
      y: 6,
      fill: '#FFFFFF',
      stroke: '#DFE2E6',
    });
    expect(scene.ops.some((op) => op.kind === 'icon')).toBe(true);
    expect(texts(scene.ops)[0]).toMatchObject({
      text: 'app.example.com/projects/q3-launch',
      size: 12,
      color: '#3F4652',
    });
  });
  it('uses the dark tokens', () => {
    const scene = layoutWindowBar({
      settings: { ...mac, theme: 'dark' },
      theme: 'dark',
      width: 1280,
      page,
    });
    expect(scene.ops[0]).toMatchObject({ fill: '#2B2D32' });
    expect(scene.ops[1]).toMatchObject({ fill: '#17181B' });
    expect(texts(scene.ops)[0].color).toBe('#D3D6DC');
  });
  it('scales every size with the window', () => {
    const scene = layoutWindowBar({ settings: mac, theme: 'light', width: 2560, page });
    expect(scene.height).toBe(72);
    expect(texts(scene.ops)[0].size).toBe(24);
  });
  it('lays Windows out with left text, three 46px controls and no lock', () => {
    const scene = layoutWindowBar({
      settings: { ...mac, style: 'windows', center: 'title' },
      theme: 'light',
      width: 1280,
      page,
    });
    expect(texts(scene.ops)[0]).toMatchObject({ x: 14, text: 'Q3 launch', align: 'left' });
    const icons = scene.ops.filter((op) => op.kind === 'icon');
    expect(icons).toHaveLength(3);
    expect(icons.map((i) => i.kind === 'icon' && i.x)).toEqual([
      1280 - 138 + 18,
      1280 - 92 + 18,
      1280 - 46 + 18,
    ]);
  });
  it('lays the browser out with three arrows and a full-width 26px field', () => {
    const scene = layoutWindowBar({
      settings: { ...mac, style: 'browser' },
      theme: 'light',
      width: 1280,
      page,
    });
    expect(scene.height).toBe(40);
    const field = scene.ops.find((op) => op.kind === 'rect' && op.r === 13);
    expect(field).toMatchObject({ h: 26, y: 7, x: 94, w: 1280 - 14 - 94 });
    expect(scene.ops.filter((op) => op.kind === 'icon')).toHaveLength(4);
  });
  it('compact (9:16): dots and domain, no address box', () => {
    const scene = layoutWindowBar({
      settings: mac,
      theme: 'light',
      width: 600,
      page,
      compact: true,
    });
    expect(scene.ops.some((op) => op.kind === 'rect' && op.r > 0)).toBe(false);
    expect(texts(scene.ops)[0].text).toBe('app.example.com');
  });
  it('crossfades between pages', () => {
    const scene = layoutWindowBar({
      settings: mac,
      theme: 'light',
      width: 1280,
      page,
      previousPage: { url: 'https://app.example.com/projects' },
      mix: 0.25,
    });
    expect(texts(scene.ops).map((t) => [t.text, t.alpha])).toEqual([
      ['app.example.com/projects', 0.75],
      ['app.example.com/projects/q3-launch', 0.25],
    ]);
  });
  it('omits the box when the center is Nothing', () => {
    const scene = layoutWindowBar({
      settings: { ...mac, center: 'none' },
      theme: 'light',
      width: 1280,
      page,
    });
    expect(scene.ops.some((op) => op.kind === 'rect' && op.r === 6)).toBe(false);
    expect(texts(scene.ops)).toHaveLength(0);
  });
});

describe('windowBarSvg', () => {
  it('writes escaped, 2x SVG', () => {
    const scene = layoutWindowBar({
      settings: { ...mac, center: 'custom', customText: 'R&D <beta>' },
      theme: 'light',
      width: 1280,
    });
    const svg = windowBarSvg(scene, 2);
    expect(svg).toContain('width="2560" height="72"');
    expect(svg).toContain('R&amp;D &lt;beta&gt;');
    expect(svg).toContain('font-family="Inter');
  });
});

describe('page timeline', () => {
  const visits = normalizePageVisits([
    { t: 4, url: 'https://a.com/two' },
    { t: 0, url: 'https://a.com/one' },
    { t: 2, url: 'https://a.com/one' },
  ]);
  it('sorts and drops repeats', () => {
    expect(visits.map((v) => v.t)).toEqual([0, 4]);
  });
  it('crossfades for 150ms after a visit', () => {
    expect(pageAtTime(visits, 3).page?.url).toBe('https://a.com/one');
    const mid = pageAtTime(visits, 4.075);
    expect(mid.page?.url).toBe('https://a.com/two');
    expect(mid.previous?.url).toBe('https://a.com/one');
    expect(mid.mix).toBeCloseTo(0.5);
    expect(pageAtTime(visits, 4.2)).toMatchObject({ previous: null, mix: 1 });
  });
  it('shows the first page before its visit', () => {
    expect(pageAtTime(normalizePageVisits([{ t: 1, url: 'https://a.com' }]), 0).page?.url).toBe(
      'https://a.com',
    );
  });
});

describe('auto theme', () => {
  const band = (value: number) => new Uint8ClampedArray(10 * 30 * 4).fill(value);
  it('goes light above 50% brightness, dark below', () => {
    expect(resolveWindowBarTheme('auto', topBandBrightness(band(240), 10, 30))).toBe('light');
    expect(resolveWindowBarTheme('auto', topBandBrightness(band(30), 10, 30))).toBe('dark');
    expect(resolveWindowBarTheme('dark', 0.9)).toBe('dark');
    expect(resolveWindowBarTheme('auto', null)).toBe('light');
  });
  it('only reads the top 24 rows', () => {
    const data = new Uint8ClampedArray(10 * 100 * 4).fill(0);
    data.fill(255, 0, 10 * 24 * 4);
    expect(topBandBrightness(data, 10, 100)).toBeCloseTo(1);
  });
});

describe('fitWindowWithBar', () => {
  it('fits bar + page in the box, page keeping its shape', () => {
    const fit = fitWindowWithBar(0, 0, 1000, 1000, 1280, 800, 'mac');
    expect(fit.window.width).toBe(1000);
    expect(fit.media.height).toBeCloseTo(625);
    expect(fit.barHeight).toBeCloseTo(28.125);
    expect(fit.media.y - fit.window.y).toBeCloseTo(fit.barHeight);
  });
  it('shrinks a height-bound window so bar + page fill the height', () => {
    const fit = fitWindowWithBar(0, 0, 1600, 700, 1280, 800, 'mac');
    expect(fit.window.height).toBeCloseTo(700, 1);
    expect(fit.media.width / fit.media.height).toBeCloseTo(1.6);
  });
  it('is the plain contain-fit with no bar', () => {
    const fit = fitWindowWithBar(0, 0, 1600, 700, 1280, 800, 'none');
    expect(fit.barHeight).toBe(0);
    expect(fit.media.height).toBeCloseTo(700);
  });
});
