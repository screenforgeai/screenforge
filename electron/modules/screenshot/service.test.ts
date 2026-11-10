// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeImage = {
  size: { width: number; height: number };
  isEmpty: () => boolean;
  getSize: () => { width: number; height: number };
  resize: ReturnType<typeof vi.fn>;
  crop: ReturnType<typeof vi.fn>;
  toDataURL: () => string;
  toPNG: () => Buffer;
};

const fakeImage = (width: number, height: number, tag = 'img'): FakeImage => {
  const image: FakeImage = {
    size: { width, height },
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: vi.fn((opts: { width: number; height: number }) =>
      fakeImage(opts.width, opts.height, `${tag}-resized`),
    ),
    crop: vi.fn((rect: { width: number; height: number }) =>
      fakeImage(rect.width, rect.height, `${tag}-cropped`),
    ),
    toDataURL: () => `data:image/png;base64,${tag}-${width}x${height}`,
    toPNG: () => Buffer.from(`png-${tag}`),
  };
  return image;
};

const electronMock = vi.hoisted(() => ({
  getSources: vi.fn(),
  getAllDisplays: vi.fn(),
  getPrimaryDisplay: vi.fn(),
  createFromDataURL: vi.fn(),
  clipboardWrite: vi.fn(),
}));

vi.mock('electron', () => ({
  desktopCapturer: { getSources: electronMock.getSources },
  screen: {
    getAllDisplays: electronMock.getAllDisplays,
    getPrimaryDisplay: electronMock.getPrimaryDisplay,
  },
  nativeImage: { createFromDataURL: electronMock.createFromDataURL },
  clipboard: { write: electronMock.clipboardWrite },
  ClipboardItem: class {
    constructor(public items: Record<string, unknown>) {}
  },
}));

import { captureStill, copyImageToClipboard } from './service';

const primary = { id: 1, size: { width: 1440, height: 900 }, scaleFactor: 2 };
const secondary = { id: 2, size: { width: 1920, height: 1080 }, scaleFactor: 1 };

describe('screenshot service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronMock.getAllDisplays.mockReturnValue([primary, secondary]);
    electronMock.getPrimaryDisplay.mockReturnValue(primary);
  });

  it('requests full-resolution thumbnails and returns the display still', async () => {
    electronMock.getSources.mockResolvedValue([
      { id: 'screen:1:0', display_id: '1', thumbnail: fakeImage(2880, 1800) },
    ]);

    const capture = await captureStill({ kind: 'display', sourceId: 'screen:1:0' });

    expect(electronMock.getSources).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ['screen'],
        thumbnailSize: { width: 2880, height: 1800 },
      }),
    );
    expect(capture).toMatchObject({ kind: 'display', width: 2880, height: 1800 });
  });

  it('crops an area from the primary display in native pixels', async () => {
    const thumb = fakeImage(2880, 1800);
    electronMock.getSources.mockResolvedValue([
      { id: 'screen:2:0', display_id: '2', thumbnail: fakeImage(1920, 1080) },
      { id: 'screen:1:0', display_id: '1', thumbnail: thumb },
    ]);

    const capture = await captureStill({
      kind: 'area',
      sourceId: 'screen:2:0',
      area: { x: 10, y: 20, width: 300, height: 200 },
    });

    expect(thumb.crop).toHaveBeenCalledWith({ x: 20, y: 40, width: 600, height: 400 });
    expect(capture).toMatchObject({ kind: 'area', width: 600, height: 400 });
  });

  it('judges an unlabelled portal source against the displays as they are after the picker', async () => {
    // Before the picker: the secondary is 5:4, so a 16:10 image could only be the primary.
    const before = [primary, { id: 2, size: { width: 1280, height: 1024 }, scaleFactor: 1 }];
    // While the picker is open the secondary switches to 16:10 too: now it's ambiguous.
    const after = [primary, { id: 2, size: { width: 1920, height: 1200 }, scaleFactor: 1 }];
    electronMock.getAllDisplays.mockReturnValueOnce(before).mockReturnValue(after);
    electronMock.getSources.mockResolvedValue([
      { id: 'screen:portal:0', display_id: '', thumbnail: fakeImage(2880, 1800) },
    ]);

    await expect(
      captureStill({ kind: 'area', sourceId: '', area: { x: 0, y: 0, width: 10, height: 10 } }),
    ).rejects.toThrow();
  });

  it('crops the display the area was drawn on, even if the primary changes during the picker', async () => {
    const drawnOn = fakeImage(2880, 1800, 'drawn-on');
    electronMock.getSources.mockResolvedValue([
      { id: 'screen:1:0', display_id: '1', thumbnail: drawnOn },
      { id: 'screen:2:0', display_id: '2', thumbnail: fakeImage(1920, 1080, 'new-primary') },
    ]);
    // The secondary became the primary while the picker was open.
    electronMock.getPrimaryDisplay.mockReturnValue(secondary);

    const capture = await captureStill({
      kind: 'area',
      sourceId: '',
      area: { x: 10, y: 20, width: 300, height: 200, display: { id: 1, width: 1440, height: 900 } },
    });

    expect(drawnOn.crop).toHaveBeenCalledWith({ x: 20, y: 40, width: 600, height: 400 });
    expect(capture).toMatchObject({ kind: 'area', width: 600, height: 400 });
  });

  it('refuses an area whose display is gone or has changed size', async () => {
    electronMock.getSources.mockResolvedValue([
      { id: 'screen:1:0', display_id: '1', thumbnail: fakeImage(2880, 1800) },
    ]);
    const area = { x: 0, y: 0, width: 10, height: 10 };
    await expect(
      captureStill({
        kind: 'area',
        sourceId: '',
        area: { ...area, display: { id: 7, width: 1440, height: 900 } },
      }),
    ).rejects.toThrow();
    await expect(
      captureStill({
        kind: 'area',
        sourceId: '',
        area: { ...area, display: { id: 1, width: 1280, height: 800 } },
      }),
    ).rejects.toThrow();
  });

  it('scales an upscaled thumbnail of a smaller display back to native size', async () => {
    // Thumbnail size is 2880×1800 (largest display); a 1920×1080 display comes back fitted to it.
    const thumb = fakeImage(2880, 1620);
    electronMock.getSources.mockResolvedValue([
      { id: 'screen:2:0', display_id: '2', thumbnail: thumb },
    ]);

    const capture = await captureStill({ kind: 'display', sourceId: 'screen:2:0' });

    expect(thumb.resize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1920, height: 1080 }),
    );
    expect(capture).toMatchObject({ width: 1920, height: 1080 });
  });

  it('captures windows as-is', async () => {
    electronMock.getSources.mockResolvedValue([
      { id: 'window:9:0', display_id: '', thumbnail: fakeImage(1200, 800) },
    ]);

    const capture = await captureStill({ kind: 'window', sourceId: 'window:9:0' });

    expect(electronMock.getSources).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['window'] }),
    );
    expect(capture).toMatchObject({ kind: 'window', width: 1200, height: 800 });
  });

  it('fails when the source is gone or the still is empty', async () => {
    electronMock.getSources.mockResolvedValue([
      { id: 'window:9:0', display_id: '', thumbnail: fakeImage(0, 0) },
    ]);
    await expect(captureStill({ kind: 'window', sourceId: 'window:9:0' })).rejects.toThrow();
    await expect(captureStill({ kind: 'window', sourceId: 'window:1:0' })).rejects.toThrow();
  });

  it('writes the image to the clipboard as a PNG item', async () => {
    electronMock.createFromDataURL.mockReturnValue(fakeImage(10, 10, 'shot'));
    electronMock.clipboardWrite.mockResolvedValue(undefined);

    await copyImageToClipboard('data:image/png;base64,abc');

    expect(electronMock.clipboardWrite).toHaveBeenCalledTimes(1);
    const [items] = electronMock.clipboardWrite.mock.calls[0] as [
      { items: Record<string, Blob> }[],
    ];
    const blob = items[0].items['image/png'];
    expect(blob.type).toBe('image/png');
    expect(Buffer.from(await blob.arrayBuffer()).toString()).toBe('png-shot');
  });

  it('refuses to copy an empty image', async () => {
    electronMock.createFromDataURL.mockReturnValue(fakeImage(0, 0));
    await expect(copyImageToClipboard('data:,')).rejects.toThrow();
    expect(electronMock.clipboardWrite).not.toHaveBeenCalled();
  });
});
