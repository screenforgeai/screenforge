import { describe, expect, it } from 'vitest';
import { selectionToImageRect } from './waylandPicker';

describe('selectionToImageRect', () => {
  // A 2560×1440 still shown on a 1080×1920 portrait screen: fitted to its width, 1080×607.5,
  // centred with 656.25 px above and below.
  const viewport = { width: 1080, height: 1920 };
  const image = { width: 2560, height: 1440 };

  it('maps a selection drawn over the fitted still to the still’s own pixels', () => {
    expect(
      selectionToImageRect({ x: 270, y: 656.25, width: 540, height: 303.75 }, viewport, image),
    ).toEqual({ x: 640, y: 0, width: 1280, height: 720 });
  });

  it('keeps only what lies on the still: the bars around it are not part of it', () => {
    expect(
      selectionToImageRect({ x: 0, y: 0, width: 1080, height: 1920 }, viewport, image),
    ).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
  });

  it('returns nothing for a selection off the still', () => {
    expect(
      selectionToImageRect({ x: 0, y: 0, width: 500, height: 300 }, viewport, image),
    ).toBeNull();
  });
});
