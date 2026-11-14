import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZoomPositionPicker } from './ZoomWidgetPositionPicker';

const FULL = { x: 0, y: 0, width: 1, height: 1 };
// The right half, bottom three quarters of the recording.
const CROP = { x: 0.5, y: 0.25, width: 0.5, height: 0.75 };

function renderPicker(crop = FULL, onChange = vi.fn()) {
  const view = render(
    <ZoomPositionPicker
      videoPath="/tmp/recording.mp4"
      videoTime={0}
      cx={0.5}
      cy={0.5}
      scale={2}
      crop={crop}
      onChange={onChange}
    />,
  );
  const picker = view.container.firstElementChild as HTMLDivElement;
  const video = view.container.querySelector('video') as HTMLVideoElement;
  return { picker, video, onChange };
}

function loadVideo(video: HTMLVideoElement, width: number, height: number) {
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: width });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: height });
  fireEvent.loadedMetadata(video);
}

afterEach(cleanup);

describe('ZoomPositionPicker', () => {
  it('shows only the cropped picture, so the crosshair matches the zoom target', () => {
    const { video } = renderPicker(CROP);

    expect(video.style.width).toBe('200%');
    expect(video.style.height).toBe(`${100 / 0.75}%`);
    expect(video.style.left).toBe('-100%');
    expect(video.style.top).toBe(`${(-0.25 / 0.75) * 100}%`);
  });

  it('takes the shape of the cropped picture once the video size is known', () => {
    const { picker, video } = renderPicker(CROP);
    loadVideo(video, 1920, 1080);

    // 960 x 810 px of picture.
    expect(picker.dataset.aspectRatio).toBe(`${960 / 810}`);
  });

  it('shows the whole recording at its own shape without a crop', () => {
    const { picker, video } = renderPicker();
    loadVideo(video, 2880, 1800);

    expect(video.style.width).toBe('100%');
    expect(video.style.left).toBe('0%');
    expect(picker.dataset.aspectRatio).toBe(`${2880 / 1800}`);
  });

  it('reports positions across the cropped picture', () => {
    const { picker, onChange } = renderPicker(CROP);
    vi.spyOn(picker, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    } as DOMRect);

    fireEvent.mouseDown(picker, { clientX: 50, clientY: 75 });

    expect(onChange).toHaveBeenCalledWith(0.25, 0.75);
  });
});
