import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_FRAME, cropRectFromPixels } from '../effects/frame';
import { getAppendPlacement } from './appendPlacement';

const probeFirst = (width: number | null, height: number | null) =>
  vi.fn().mockResolvedValue({ fps: 60, width, height, duration: 5 });

describe('getAppendPlacement', () => {
  it('fits the appended clip into the exact pixels of the project crop', async () => {
    const frame = {
      ...DEFAULT_FRAME,
      cropRect: cropRectFromPixels({ x: 151, y: 99, width: 1201, height: 803 }, 3024, 1964),
    };
    const probe = probeFirst(3024, 1964);

    await expect(getAppendPlacement('/first.mp4', frame, undefined, probe)).resolves.toEqual({
      target: { x: 151, y: 99, width: 1201, height: 803 },
    });
    expect(probe).toHaveBeenCalledWith('/first.mp4');
  });

  it('cuts an appended area recording to its own area', async () => {
    const placement = await getAppendPlacement(
      '/first.mp4',
      DEFAULT_FRAME,
      { x: 7, y: 3, width: 641, height: 359, sourceWidth: 1920, sourceHeight: 1080 },
      probeFirst(1920, 1080),
    );
    expect(placement).toEqual({ secondCrop: { x: 7, y: 3, width: 641, height: 359 } });
  });

  it('changes nothing for an uncropped project and a whole-screen clip', async () => {
    const probe = probeFirst(1920, 1080);
    await expect(
      getAppendPlacement('/first.mp4', DEFAULT_FRAME, undefined, probe),
    ).resolves.toEqual({});
    expect(probe).not.toHaveBeenCalled();
  });

  it('skips the target when the first clip cannot be measured', async () => {
    const frame = {
      ...DEFAULT_FRAME,
      cropRect: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    };
    await expect(
      getAppendPlacement('/first.mp4', frame, undefined, probeFirst(null, null)),
    ).resolves.toEqual({});
  });
});
