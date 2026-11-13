// @vitest-environment node

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  helperExists: true,
  files: new Map<string, Buffer>(),
}));

const spawnMock = vi.hoisted(() => vi.fn());

const imageMock = vi.hoisted(() => ({
  createFromBitmap: vi.fn(() => ({ toPNG: () => Buffer.from([137, 80, 78, 71]) })),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/dev/project',
  },
  nativeImage: imageMock,
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

vi.mock('node:fs', () => {
  const fs = {
    existsSync: () => fsMock.helperExists,
    promises: {
      readFile: async (file: string) => {
        const value = fsMock.files.get(file);
        if (!value) {
          throw new Error('ENOENT');
        }
        return value;
      },
      rm: async (file: string) => {
        fsMock.files.delete(file);
      },
    },
  };
  return { default: fs, ...fs };
});

vi.mock('../../lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type FakeHelper = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  say: (message: object) => void;
  commands: () => string[][];
};

function fakeHelper(): FakeHelper {
  const helper = new EventEmitter() as FakeHelper;
  helper.stdin = new PassThrough();
  helper.stdout = new PassThrough();
  helper.stderr = new PassThrough();
  let written = '';
  helper.stdin.on('data', (chunk: Buffer) => {
    written += chunk.toString();
  });
  helper.commands = () =>
    written
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'));
  helper.kill = vi.fn(() => {
    process.nextTick(() => {
      helper.emit('exit', null, 'SIGTERM');
      helper.emit('close', null, 'SIGTERM');
    });
    return true;
  });
  helper.say = (message) => helper.stdout.write(`${JSON.stringify(message)}\n`);
  return helper;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

const screen = { x: 1080, y: 272, width: 2560, height: 1440 };
const video = { width: 2560, height: 1440, format: 'bgr0' };

async function load() {
  return import('./wayland-capture');
}

/** A helper whose screen was picked. */
async function picked() {
  const helper = fakeHelper();
  spawnMock.mockReturnValue(helper);
  const module = await load();
  const pick = module.pickWaylandScreen();
  helper.say({ type: 'ready', screen });
  helper.say({ type: 'video', ...video });
  await expect(pick).resolves.toBe('picked');
  return { helper, ...module };
}

beforeEach(() => {
  vi.resetModules();
  spawnMock.mockReset();
  imageMock.createFromBitmap.mockClear();
  fsMock.helperExists = true;
  fsMock.files.clear();
});

describe('parseCaptureHelperLine', () => {
  it('reads each message the helper sends', async () => {
    const { parseCaptureHelperLine } = await load();

    expect(parseCaptureHelperLine(JSON.stringify({ type: 'ready', screen }))).toEqual({
      type: 'ready',
      screen,
    });
    expect(parseCaptureHelperLine(JSON.stringify({ type: 'video', ...video }))).toEqual({
      type: 'video',
      ...video,
    });
    expect(parseCaptureHelperLine('{"type":"move","x":1.5,"y":2}')).toEqual({
      type: 'move',
      x: 1.5,
      y: 2,
    });
    expect(parseCaptureHelperLine('{"type":"recorded","ok":true,"frames":60,"late":1}')).toEqual({
      type: 'recorded',
      ok: true,
      frames: 60,
      late: 1,
    });
    expect(
      parseCaptureHelperLine('{"type":"still","path":"/tmp/s.bgra","width":2,"height":3}'),
    ).toEqual({ type: 'still', path: '/tmp/s.bgra', width: 2, height: 3 });
    expect(parseCaptureHelperLine('{"type":"ended"}')).toEqual({ type: 'ended' });
    expect(parseCaptureHelperLine('{"type":"error","code":"cancelled","message":"no"}')).toEqual({
      type: 'error',
      code: 'cancelled',
      message: 'no',
    });
  });

  it('ignores anything else', async () => {
    const { parseCaptureHelperLine } = await load();

    expect(parseCaptureHelperLine('not json')).toBeNull();
    expect(parseCaptureHelperLine('{"type":"move","x":"1","y":2}')).toBeNull();
    expect(
      parseCaptureHelperLine('{"type":"video","width":2,"height":2,"format":"yuv"}'),
    ).toBeNull();
    expect(parseCaptureHelperLine('{"type":"ready","screen":{"x":0,"y":0,"width":0}}')).toBeNull();
    expect(parseCaptureHelperLine('{"type":"other"}')).toBeNull();
  });
});

describe('buildShareRecordArgs', () => {
  it('encodes the raw frames to H.264 at 60 frames a second up to 1080p', async () => {
    const { buildShareRecordArgs } = await load();

    const { fps, args } = buildShareRecordArgs(
      { width: 1920, height: 1080, format: 'bgr0' },
      '/tmp/out.mp4',
    );

    expect(fps).toBe(60);
    expect(args.join(' ')).toContain(
      '-f rawvideo -pix_fmt bgr0 -video_size 1920x1080 -framerate 60 -i pipe:0',
    );
    expect(args).toContain('libopenh264');
    expect(args.at(-1)).toBe('/tmp/out.mp4');
  });

  it('drops to 30 frames a second past 1080p, so the encoder keeps up', async () => {
    const { buildShareRecordArgs } = await load();

    expect(buildShareRecordArgs(video, '/o.mp4').fps).toBe(30);
    expect(buildShareRecordArgs({ width: 3840, height: 2160, format: 'bgr0' }, '/o.mp4').fps).toBe(
      30,
    );
  });
});

describe('pickWaylandScreen', () => {
  it('is picked once the picture arrives, and the share is kept', async () => {
    const { helper, hasWaylandShare, getWaylandShare } = await picked();

    expect(spawnMock).toHaveBeenCalledWith(
      `/dev/project/native/bin/linux-${process.arch}/screenforge-wayland-capture`,
      [],
      expect.anything(),
    );
    expect(hasWaylandShare()).toBe(true);
    expect(getWaylandShare()).toEqual({ screen, video });
    expect(helper.kill).not.toHaveBeenCalled();
  });

  it('is cancelled when the dialog is closed', async () => {
    const helper = fakeHelper();
    spawnMock.mockReturnValue(helper);
    const { pickWaylandScreen, hasWaylandShare } = await load();

    const pick = pickWaylandScreen();
    helper.say({ type: 'error', code: 'cancelled', message: 'closed' });

    await expect(pick).resolves.toBe('cancelled');
    expect(hasWaylandShare()).toBe(false);
  });

  it('is unavailable without the helper, or when it cannot run here', async () => {
    fsMock.helperExists = false;
    const { pickWaylandScreen } = await load();
    await expect(pickWaylandScreen()).resolves.toBe('unavailable');
    expect(spawnMock).not.toHaveBeenCalled();

    fsMock.helperExists = true;
    const unsupported = fakeHelper();
    spawnMock.mockReturnValue(unsupported);
    const first = pickWaylandScreen();
    unsupported.say({ type: 'error', code: 'unsupported', message: 'old portal' });
    await expect(first).resolves.toBe('unavailable');

    const broken = fakeHelper();
    spawnMock.mockReturnValue(broken);
    const second = pickWaylandScreen();
    broken.emit('close', 127, null);
    await expect(second).resolves.toBe('unavailable');
  });

  it('is unavailable at once when the helper cannot be started', async () => {
    const helper = fakeHelper();
    spawnMock.mockReturnValue(helper);
    const { pickWaylandScreen, hasWaylandShare } = await load();

    const pick = pickWaylandScreen();
    helper.emit('error', new Error('spawn EACCES'));

    await expect(pick).resolves.toBe('unavailable');
    expect(hasWaylandShare()).toBe(false);
  });

  it('fails with the reason when the share could not start', async () => {
    const helper = fakeHelper();
    spawnMock.mockReturnValue(helper);
    const { pickWaylandScreen } = await load();

    const pick = pickWaylandScreen();
    helper.say({ type: 'error', code: 'failed', message: 'PipeWire is not running' });

    await expect(pick).rejects.toThrow('PipeWire is not running');
  });

  it('lets a previous share go before asking again', async () => {
    const { helper, pickWaylandScreen } = await picked();
    spawnMock.mockReturnValue(fakeHelper());

    void pickWaylandScreen();

    expect(helper.kill).toHaveBeenCalled();
  });
});

describe('recording a picked screen', () => {
  it('sends the frame rate and FFmpeg command, and starts once the helper is recording', async () => {
    const { helper, startWaylandShareRecording } = await picked();

    const started = startWaylandShareRecording('/usr/bin/ffmpeg', '/tmp/out.mp4');
    await tick();
    const [command] = helper.commands();
    expect(command.slice(0, 3)).toEqual(['record', '30', '/usr/bin/ffmpeg']);
    expect(command.at(-1)).toBe('/tmp/out.mp4');

    helper.say({ type: 'recording' });
    await expect(started).resolves.toEqual({ fps: 30 });
  });

  it('passes pause and resume on, and finishes on stop', async () => {
    const { helper, ...share } = await picked();
    const started = share.startWaylandShareRecording('/usr/bin/ffmpeg', '/tmp/out.mp4');
    helper.say({ type: 'recording' });
    await started;

    share.pauseWaylandShareRecording();
    share.resumeWaylandShareRecording();
    const finished = share.finishWaylandShareRecording();
    await tick();
    helper.say({ type: 'recorded', ok: true, frames: 120, late: 0 });

    await expect(finished).resolves.toEqual({ ok: true, frames: 120, late: 0 });
    expect(
      helper
        .commands()
        .slice(1)
        .map(([name]) => name),
    ).toEqual(['pause', 'resume', 'stop']);
  });

  it('keeps what was recorded when the share ends from the system', async () => {
    const { helper, ...share } = await picked();
    const ended = vi.fn();
    share.onWaylandShareEnded(ended);
    const started = share.startWaylandShareRecording('/usr/bin/ffmpeg', '/tmp/out.mp4');
    helper.say({ type: 'recording' });
    await started;

    helper.say({ type: 'recorded', ok: true, frames: 30, late: 0 });
    helper.say({ type: 'ended' });
    helper.emit('close', 0, null);
    await tick();

    expect(ended).toHaveBeenCalled();
    expect(share.hasWaylandShare()).toBe(false);
    await expect(share.finishWaylandShareRecording()).resolves.toEqual({
      ok: true,
      frames: 30,
      late: 0,
    });
    expect(share.getWaylandShare()).toEqual({ screen, video });
  });

  it('tells the app when the helper dies without ending the share', async () => {
    const { helper, ...share } = await picked();
    const ended = vi.fn();
    share.onWaylandShareEnded(ended);

    helper.emit('close', null, 'SIGKILL');
    await tick();

    expect(ended).toHaveBeenCalledTimes(1);
    expect(share.hasWaylandShare()).toBe(false);
  });

  it('does not tell the app when the share is let go on purpose', async () => {
    const { endWaylandShare, onWaylandShareEnded } = await picked();
    const ended = vi.fn();
    onWaylandShareEnded(ended);

    endWaylandShare();
    await tick();

    expect(ended).not.toHaveBeenCalled();
  });

  it('keeps a new share working while the old helper is still closing', async () => {
    const { helper: old, pickWaylandScreen, getWaylandShareStill } = await picked();
    old.kill.mockImplementation(() => true); // closes later
    const next = fakeHelper();
    spawnMock.mockReturnValue(next);
    const pick = pickWaylandScreen();
    next.say({ type: 'ready', screen });
    next.say({ type: 'video', ...video });
    await pick;

    const still = getWaylandShareStill();
    await tick();
    old.emit('exit', null, 'SIGTERM');
    old.emit('close', null, 'SIGTERM');
    await tick();
    const [[, stillPath]] = next.commands().filter(([name]) => name === 'still');
    fsMock.files.set(stillPath, Buffer.alloc(4));
    next.say({ type: 'still', path: stillPath, width: 1, height: 1 });

    await expect(still).resolves.toMatchObject({ width: 1, height: 1 });
  });

  it('refuses to record once the share has ended', async () => {
    const { helper, startWaylandShareRecording } = await picked();
    helper.say({ type: 'ended' });
    await tick();

    await expect(startWaylandShareRecording('/usr/bin/ffmpeg', '/tmp/out.mp4')).rejects.toThrow(
      /Pick the screen again/,
    );
  });

  it('reports pointer moves while the share is open, and keeps the last one', async () => {
    const { helper, setWaylandShareMoveListener, getWaylandSharePointer, pickWaylandScreen } =
      await picked();
    const moves: [number, number][] = [];
    setWaylandShareMoveListener((x, y) => moves.push([x, y]));
    expect(getWaylandSharePointer()).toBeNull();

    helper.say({ type: 'move', x: 1500, y: 600 });
    await tick();

    expect(moves).toEqual([[1500, 600]]);
    expect(getWaylandSharePointer()).toEqual({ x: 1500, y: 600 });

    // A new pick forgets the old screen's pointer.
    spawnMock.mockReturnValue(fakeHelper());
    void pickWaylandScreen();
    expect(getWaylandSharePointer()).toBeNull();
  });
});

describe('getWaylandShareStill', () => {
  it('turns the helper picture into a PNG and removes the file', async () => {
    const { helper, getWaylandShareStill } = await picked();

    const still = getWaylandShareStill();
    await tick();
    const [[, stillPath]] = helper.commands().filter(([name]) => name === 'still');
    fsMock.files.set(stillPath, Buffer.alloc(2560 * 1440 * 4));
    helper.say({ type: 'still', path: stillPath, width: 2560, height: 1440 });

    await expect(still).resolves.toEqual({
      png: new Uint8Array([137, 80, 78, 71]),
      width: 2560,
      height: 1440,
    });
    expect(imageMock.createFromBitmap).toHaveBeenCalledWith(expect.any(Buffer), {
      width: 2560,
      height: 1440,
    });
    expect(fsMock.files.has(stillPath)).toBe(false);
  });
});

describe('endWaylandShare', () => {
  it('stops the helper and fails what was waiting on it', async () => {
    const { helper, endWaylandShare, getWaylandShareStill, hasWaylandShare } = await picked();

    const still = getWaylandShareStill();
    await tick();
    endWaylandShare();

    await expect(still).rejects.toThrow(/ended/);
    expect(helper.kill).toHaveBeenCalledWith('SIGTERM');
    expect(hasWaylandShare()).toBe(false);
  });
});
