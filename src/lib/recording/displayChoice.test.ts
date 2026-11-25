import { describe, expect, it } from 'vitest';
import { formatDisplaySize } from './displayChoice';

describe('displayChoice', () => {
  it('formats the size in DIPs', () => {
    expect(
      formatDisplaySize({ id: 1, label: null, width: 2560, height: 1440, isPrimary: false }),
    ).toBe('2560 × 1440');
  });
});
