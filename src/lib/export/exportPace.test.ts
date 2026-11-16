import { describe, expect, it, vi } from 'vitest';
import { createExportPace } from './exportPace';

describe('createExportPace', () => {
  it('reports the frame rate of each interval, not the running average', () => {
    let now = 0;
    const emit = vi.fn();
    const pace = createExportPace({ totalFrames: 600, intervalMs: 5000, now: () => now, emit });

    now = 1000;
    pace.sample(30, { renderMs: 100 });
    expect(emit).not.toHaveBeenCalled();

    now = 5000;
    pace.sample(300, { renderMs: 900.4 });
    expect(emit).toHaveBeenLastCalledWith({
      frames: 300,
      of: 600,
      fps: 60,
      elapsedS: 5,
      renderMs: 900,
    });

    // A slower stretch shows up as a lower rate.
    now = 10_000;
    pace.sample(400, { renderMs: 1500 });
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ frames: 400, fps: 20, elapsedS: 10 }),
    );
    expect(emit).toHaveBeenCalledTimes(2);
  });
});
