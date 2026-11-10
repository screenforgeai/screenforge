import { describe, expect, it } from 'vitest';
import type { CursorEvent } from 'src/types';
import { getMoveEvents } from './analyze';

const AREA = { x: 0, y: 0, width: 1000, height: 1000 };

// A deliberate one-sample excursion, as a generated cursor path can make.
const events: CursorEvent[] = [100, 100, 900, 100, 100].map((x, i) => ({
  type: 'move',
  x,
  y: 500,
  timestamp: 1000 + i * 16,
}));

describe('getMoveEvents', () => {
  it('median-filters captured paths, removing single-sample spikes', () => {
    const moves = getMoveEvents(events, 1000, AREA);
    expect(moves.map((m) => m.nx)).toEqual([0.1, 0.1, 0.1, 0.1, 0.1]);
  });

  it('keeps a synthetic path exactly as generated (Director recordings)', () => {
    const moves = getMoveEvents(events, 1000, AREA, undefined, true);
    expect(moves.map((m) => m.nx)).toEqual([0.1, 0.1, 0.9, 0.1, 0.1]);
  });
});
