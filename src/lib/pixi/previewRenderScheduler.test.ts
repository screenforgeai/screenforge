import { describe, expect, it, vi } from 'vitest';
import { invalidatePreview, onPreviewInvalidated } from './previewInvalidation';
import { createPreviewRenderScheduler, PREVIEW_SETTLE_MS } from './previewRenderScheduler';

describe('preview render scheduler', () => {
  it('draws nothing while paused before anything changed', () => {
    const scheduler = createPreviewRenderScheduler();
    expect(scheduler.shouldRender(5_000, false)).toBe(false);
  });

  it('keeps drawing after a change until the scene settles, not just one frame', () => {
    const scheduler = createPreviewRenderScheduler();
    scheduler.markDirty(1_000);

    expect(scheduler.shouldRender(1_016, false)).toBe(true);
    expect(scheduler.shouldRender(1_000 + PREVIEW_SETTLE_MS - 1, false)).toBe(true);
    expect(scheduler.shouldRender(1_000 + PREVIEW_SETTLE_MS, false)).toBe(false);
  });

  it('restarts the settle window on every change', () => {
    const scheduler = createPreviewRenderScheduler(1_000);
    scheduler.markDirty(0);
    scheduler.markDirty(800);

    expect(scheduler.shouldRender(1_500, false)).toBe(true);
    expect(scheduler.shouldRender(1_800, false)).toBe(false);
  });

  it('never moves the settle window back for a change stamped earlier', () => {
    const scheduler = createPreviewRenderScheduler(1_000);
    scheduler.markDirty(800);
    scheduler.markDirty(100);

    expect(scheduler.shouldRender(1_500, false)).toBe(true);
  });

  it('draws every frame while playing, changed or not', () => {
    const scheduler = createPreviewRenderScheduler();
    expect(scheduler.shouldRender(10_000, true)).toBe(true);
    expect(scheduler.shouldRender(99_000, true)).toBe(true);
  });
});

describe('preview invalidation', () => {
  it('reaches every subscriber until it unsubscribes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onPreviewInvalidated(first);
    const offSecond = onPreviewInvalidated(second);

    invalidatePreview();
    offFirst();
    invalidatePreview();
    offSecond();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
