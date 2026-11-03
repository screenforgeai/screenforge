import { describe, expect, it } from 'vitest';
import { getPreloadPercent } from './startupPermissions';

describe('startupPermissions', () => {
  it('clamps preload percent to a valid range', () => {
    expect(getPreloadPercent({ task: 'Init', completed: 1, total: 3 })).toBe(33);
    expect(getPreloadPercent({ task: 'Init', completed: 5, total: 3 })).toBe(100);
    expect(getPreloadPercent({ task: 'Init', completed: 0, total: 0 })).toBe(0);
  });
});
