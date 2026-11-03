import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME } from '../../store';
import { computeExportRenderSize } from './renderSizing';

describe('computeExportRenderSize', () => {
  it('renders small sources at least as large as the requested export target', () => {
    const size = computeExportRenderSize(DEFAULT_FRAME, 1280, 720, 1920, 1080);

    expect(size.renderScale).toBeGreaterThan(1);
    expect(size.sourceWidth).toBeGreaterThanOrEqual(1920);
    expect(size.sourceHeight).toBeGreaterThanOrEqual(1080);
    expect(size.canvasWidth).toBeGreaterThanOrEqual(1920);
    expect(size.canvasHeight).toBeGreaterThanOrEqual(1080);
  });

  it('scales large sources down to the encoder target so drawImage is a 1:1 blit', () => {
    const size = computeExportRenderSize(DEFAULT_FRAME, 3840, 2160, 1920, 1080);

    expect(size.renderScale).toBe(0.5);
    expect(size.canvasWidth).toBe(1920);
    expect(size.canvasHeight).toBe(1080);
  });

  it('supports framed aspect-ratio exports without undershooting the target', () => {
    const size = computeExportRenderSize(
      {
        ...DEFAULT_FRAME,
        aspectRatioId: '4:3',
      },
      320,
      180,
      960,
      720,
    );

    expect(size.canvasWidth).toBeGreaterThanOrEqual(960);
    expect(size.canvasHeight).toBeGreaterThanOrEqual(720);
  });

  it('keeps odd source dimensions compatible with even output targets', () => {
    const size = computeExportRenderSize(DEFAULT_FRAME, 853, 480, 1280, 720);

    expect(Number.isInteger(size.sourceWidth)).toBe(true);
    expect(Number.isInteger(size.sourceHeight)).toBe(true);
    expect(Number.isInteger(size.canvasWidth)).toBe(true);
    expect(Number.isInteger(size.canvasHeight)).toBe(true);
    expect(size.canvasWidth).toBeGreaterThanOrEqual(1280);
    expect(size.canvasHeight).toBeGreaterThanOrEqual(720);
  });
});
