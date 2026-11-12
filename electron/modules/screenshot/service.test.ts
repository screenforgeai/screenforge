// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A PNG header (signature + IHDR) for the given size. */
const pngHeader = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

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
    toPNG: () => pngHeader(width, height),
  };
  return image;
};

const electronMock = vi.hoisted(() => ({
  getSources: vi.fn(),
  getAllDisplays: vi.fn(),
  getPrimaryDisplay: vi.fn(),
  clipboardWrite: vi.fn(),
}));

const nodeMock = vi.hoisted(() => ({
  execFile: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFile: nodeMock.execFile }));
vi.mock('node:fs/promises', () => ({ readFile: nodeMock.readFile, rm: nodeMock.rm }));
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));

vi.mock('electron', () => ({
  desktopCapturer: { getSources: electronMock.getSources },
  screen: {
    getAllDisplays: electronMock.getAllDisplays,
    getPrimaryDisplay: electronMock.getPrimaryDisplay,
  },
  clipboard: { write: electronMock.clipboardWrite },
  ClipboardItem: class {
    constructor(public items: Record<string, unknown>) {}
  },
}));

import { captureStill, copyImageToClipboard } from './service';

const primary = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1440, height: 900 },
  size: { width: 1440, height: 900 },
  scaleFactor: 2,
};
const secondary = {
  id: 2,
  bounds: { x: 1440, y: 0, width: 1920, height: 1080 },
  size: { width: 1920, height: 1080 },
  scaleFactor: 1,
};

const realPlatform = process.platform;
const setPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });

describe('screenshot service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('linux');
    electronMock.getAllDisplays.mockReturnValue([primary, secondary]);
    electronMock.getPrimaryDisplay.mockReturnValue(primary);
  });

  afterEach(() => {
    setPlatform(realPlatform);
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

  it('asks for thumbnails at the area display size, so a larger monitor never forces a resample', async () => {
    // A 4K monitor next to the laptop: fitting the laptop's frame into 3840×2160 would
    // upscale it, and scaling it back down would blur it.
    const external = {
      id: 2,
      bounds: { x: 1440, y: 0, width: 3840, height: 2160 },
      size: { width: 3840, height: 2160 },
      scaleFactor: 1,
    };
    electronMock.getAllDisplays.mockReturnValue([primary, external]);
    const thumb = fakeImage(2880, 1800);
    electronMock.getSources.mockResolvedValue([
      { id: 'screen:1:0', display_id: '1', thumbnail: thumb },
    ]);

    const capture = await captureStill({
      kind: 'area',
      sourceId: '',
      area: { x: 10, y: 20, width: 300, height: 200, display: { id: 1, width: 1440, height: 900 } },
    });

    expect(electronMock.getSources).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnailSize: { width: 2880, height: 1800 } }),
    );
    expect(thumb.resize).not.toHaveBeenCalled();
    expect(thumb.crop).toHaveBeenCalledWith({ x: 20, y: 40, width: 600, height: 400 });
    expect(capture).toMatchObject({ kind: 'area', width: 600, height: 400 });
  });

  it('crops before resampling, so only the area is ever resized', async () => {
    // The display dropped to 1x while the portal picker was open: the 2x thumbnail is too big.
    const at1x = { ...primary, scaleFactor: 1 };
    electronMock.getAllDisplays
      .mockReturnValueOnce([primary, secondary])
      .mockReturnValue([at1x, secondary]);
    electronMock.getPrimaryDisplay.mockReturnValue(at1x);
    const thumb = fakeImage(2880, 1800);
    electronMock.getSources.mockResolvedValue([
      { id: 'screen:1:0', display_id: '1', thumbnail: thumb },
    ]);

    const capture = await captureStill({
      kind: 'area',
      sourceId: '',
      area: { x: 10, y: 20, width: 300, height: 200 },
    });

    expect(thumb.resize).not.toHaveBeenCalled();
    expect(thumb.crop).toHaveBeenCalledWith({ x: 20, y: 40, width: 600, height: 400 });
    const cropped = thumb.crop.mock.results[0].value as FakeImage;
    expect(cropped.resize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 300, height: 200 }),
    );
    expect(capture).toMatchObject({ width: 300, height: 200 });
    expect(capture.png).toEqual(pngHeader(300, 200));
  });

  describe('on macOS', () => {
    const png = pngHeader(600, 400);

    beforeEach(() => {
      setPlatform('darwin');
      nodeMock.execFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (error: Error | null) => void) =>
          cb(null),
      );
      nodeMock.readFile.mockResolvedValue(png);
      nodeMock.rm.mockResolvedValue(undefined);
    });

    it('captures just the area with screencapture, at native resolution, without re-encoding', async () => {
      electronMock.getAllDisplays.mockReturnValue([secondary, primary]);
      electronMock.getPrimaryDisplay.mockReturnValue(secondary);

      const capture = await captureStill({
        kind: 'area',
        sourceId: '',
        area: {
          x: 10,
          y: 20,
          width: 300,
          height: 200,
          display: { id: 2, width: 1920, height: 1080 },
        },
      });

      expect(electronMock.getSources).not.toHaveBeenCalled();
      const [cmd, args] = nodeMock.execFile.mock.calls[0] as [string, string[]];
      expect(cmd).toBe('/usr/sbin/screencapture');
      expect(args).toEqual(expect.arrayContaining(['-x', '-t', 'png', '-R', '1450,20,300,200']));
      const file = args[args.length - 1];
      expect(nodeMock.readFile).toHaveBeenCalledWith(file);
      expect(nodeMock.rm).toHaveBeenCalledWith(file, { force: true });
      // The file's bytes, as they are: no decode, no re-encode, no base64.
      expect(capture).toEqual({ kind: 'area', png, width: 600, height: 400 });
    });

    it('falls back to the desktop capturer when screencapture fails', async () => {
      nodeMock.execFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, cb: (error: Error | null) => void) =>
          cb(new Error('could not create image from rect')),
      );
      const thumb = fakeImage(2880, 1800);
      electronMock.getSources.mockResolvedValue([
        { id: 'screen:1:0', display_id: '1', thumbnail: thumb },
      ]);

      const capture = await captureStill({
        kind: 'area',
        sourceId: '',
        area: { x: 10, y: 20, width: 300, height: 200 },
      });

      expect(thumb.crop).toHaveBeenCalledWith({ x: 20, y: 40, width: 600, height: 400 });
      expect(capture).toMatchObject({ kind: 'area', width: 600, height: 400 });
      expect(nodeMock.rm).toHaveBeenCalled();
    });

    it('falls back when screencapture writes an empty image', async () => {
      nodeMock.readFile.mockResolvedValue(Buffer.alloc(0));
      electronMock.getSources.mockResolvedValue([
        { id: 'screen:1:0', display_id: '1', thumbnail: fakeImage(2880, 1800) },
      ]);

      const capture = await captureStill({
        kind: 'area',
        sourceId: '',
        area: { x: 10, y: 20, width: 300, height: 200 },
      });

      expect(electronMock.getSources).toHaveBeenCalled();
      expect(capture).toMatchObject({ width: 600, height: 400 });
    });

    it('still refuses an area whose display is gone', async () => {
      await expect(
        captureStill({
          kind: 'area',
          sourceId: '',
          area: { x: 0, y: 0, width: 10, height: 10, display: { id: 7, width: 1440, height: 900 } },
        }),
      ).rejects.toThrow();
      expect(nodeMock.execFile).not.toHaveBeenCalled();
    });
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

  it('writes the PNG bytes to the clipboard as-is', async () => {
    electronMock.clipboardWrite.mockResolvedValue(undefined);
    const png = pngHeader(10, 10);

    await copyImageToClipboard(png);

    expect(electronMock.clipboardWrite).toHaveBeenCalledTimes(1);
    const [items] = electronMock.clipboardWrite.mock.calls[0] as [
      { items: Record<string, Blob> }[],
    ];
    const blob = items[0].items['image/png'];
    expect(blob.type).toBe('image/png');
    expect(Buffer.from(await blob.arrayBuffer())).toEqual(png);
  });

  it('refuses to copy anything that is not a PNG', async () => {
    await expect(copyImageToClipboard(Buffer.from('not an image'))).rejects.toThrow();
    await expect(
      copyImageToClipboard('data:image/png;base64,AAAA' as unknown as Uint8Array),
    ).rejects.toThrow();
    expect(electronMock.clipboardWrite).not.toHaveBeenCalled();
  });
});
