/**
 * Screen recording on Wayland through the screenforge-wayland-capture helper
 * (native/linux/WaylandCapture).
 *
 * Wayland shows apps the screen only through the system share dialog, and no
 * app can read the pointer. Chromium's own screen share always paints the
 * pointer into the picture, so the editor's drawn cursor would come out
 * doubled. The helper opens the share itself with the pointer kept apart: it
 * records the screen without it and reports where it is, and the editor draws
 * the one cursor. The user picks the screen in the same system dialog.
 *
 * One share at a time: picked before the countdown, recorded, then let go when
 * the recording stops or the pick is dropped.
 */

import { app, nativeImage } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import log from '../../lib/logger';

export interface ShareScreen {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShareVideo {
  width: number;
  height: number;
  /** FFmpeg pixel format of the raw frames. */
  format: string;
}

export interface ShareRecorded {
  ok: boolean;
  frames: number;
  late: number;
}

export type CaptureHelperMessage =
  | { type: 'ready'; screen: ShareScreen }
  | ({ type: 'video' } & ShareVideo)
  | { type: 'move'; x: number; y: number }
  | { type: 'recording' }
  | ({ type: 'recorded' } & ShareRecorded)
  | { type: 'still'; path: string; width: number; height: number }
  | { type: 'ended' }
  | { type: 'error'; code: string; message: string };

/** How a pick went: the share is ready, the dialog was closed, or the helper can't run here. */
export type ScreenPick = 'picked' | 'cancelled' | 'unavailable';

const HELPER_NAME = 'screenforge-wayland-capture';
const PIXEL_FORMATS = new Set(['bgr0', 'rgb0', 'bgra', 'rgba']);
// The dialog waits on the user; past this the helper is taken to be stuck.
const PICK_TIMEOUT_MS = 5 * 60_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

/** One line of the helper's output, or null when it isn't a message it sends. */
export function parseCaptureHelperLine(line: string): CaptureHelperMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const message = value as Record<string, unknown>;
  switch (message.type) {
    case 'move':
      return isFiniteNumber(message.x) && isFiniteNumber(message.y)
        ? { type: 'move', x: message.x, y: message.y }
        : null;
    case 'ready': {
      const screen = message.screen as Record<string, unknown> | undefined;
      return screen &&
        isFiniteNumber(screen.x) &&
        isFiniteNumber(screen.y) &&
        isFiniteNumber(screen.width) &&
        isFiniteNumber(screen.height) &&
        screen.width > 0 &&
        screen.height > 0
        ? {
            type: 'ready',
            screen: { x: screen.x, y: screen.y, width: screen.width, height: screen.height },
          }
        : null;
    }
    case 'video':
      return isPositiveInteger(message.width) &&
        isPositiveInteger(message.height) &&
        typeof message.format === 'string' &&
        PIXEL_FORMATS.has(message.format)
        ? { type: 'video', width: message.width, height: message.height, format: message.format }
        : null;
    case 'recording':
    case 'ended':
      return { type: message.type };
    case 'recorded':
      return {
        type: 'recorded',
        ok: message.ok === true,
        frames: isFiniteNumber(message.frames) ? message.frames : 0,
        late: isFiniteNumber(message.late) ? message.late : 0,
      };
    case 'still':
      return typeof message.path === 'string' &&
        isPositiveInteger(message.width) &&
        isPositiveInteger(message.height)
        ? { type: 'still', path: message.path, width: message.width, height: message.height }
        : null;
    case 'error':
      return {
        type: 'error',
        code: typeof message.code === 'string' ? message.code : 'failed',
        message: typeof message.message === 'string' ? message.message : '',
      };
    default:
      return null;
  }
}

/**
 * FFmpeg arguments that encode the helper's raw frames (read from stdin) to an MP4: 60 frames a
 * second up to 1080p, 30 past it, where the software encoder can't keep up with 60 live.
 */
export function buildShareRecordArgs(
  video: ShareVideo,
  outPath: string,
): { fps: number; args: string[] } {
  const fps = video.width * video.height > 1920 * 1080 ? 30 : 60;
  return {
    fps,
    args: [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostats',
      '-f',
      'rawvideo',
      '-pix_fmt',
      video.format,
      '-video_size',
      `${video.width}x${video.height}`,
      '-framerate',
      String(fps),
      '-i',
      'pipe:0',
      // H.264 needs even sides.
      '-vf',
      'crop=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p,setsar=1',
      '-c:v',
      'libopenh264',
      '-b:v',
      '20000k',
      '-an',
      '-movflags',
      '+faststart',
      '-y',
      outPath,
    ],
  };
}

function helperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, HELPER_NAME)
    : path.join(app.getAppPath(), 'native', 'bin', `linux-${process.arch}`, HELPER_NAME);
}

type Waiter = {
  type: CaptureHelperMessage['type'];
  resolve: (message: CaptureHelperMessage) => void;
  reject: (error: Error) => void;
};

let helper: ChildProcessWithoutNullStreams | null = null;
let picking: Promise<ScreenPick> | null = null;
let share: { screen: ShareScreen; video: ShareVideo } | null = null;
let shareEnded = false;
let recorded: ShareRecorded | null = null;
let waiters: Waiter[] = [];
let moveListener: ((x: number, y: number) => void) | null = null;
// The helper reports the pointer only when it moves: the last report is where it is now.
let lastPointer: { x: number; y: number } | null = null;
const endedListeners = new Set<() => void>();

/** Where pointer moves go while a share is open. */
export function setWaylandShareMoveListener(
  listener: ((x: number, y: number) => void) | null,
): void {
  moveListener = listener;
}

/** Told when the share ends from outside the app (stopped from the system, screen gone). */
export function onWaylandShareEnded(listener: () => void): () => void {
  endedListeners.add(listener);
  return () => {
    endedListeners.delete(listener);
  };
}

/** Where the pointer was last reported on the picked screen, or null before any report. */
export function getWaylandSharePointer(): { x: number; y: number } | null {
  return lastPointer;
}

/** A share is picked and still live. */
export function hasWaylandShare(): boolean {
  return helper !== null && share !== null && !shareEnded;
}

/** The screen and picture of the last share, kept after it ends for the recording being saved. */
export function getWaylandShare(): { screen: ShareScreen; video: ShareVideo } | null {
  return share;
}

function waitFor(type: CaptureHelperMessage['type']): Promise<CaptureHelperMessage> {
  return new Promise((resolve, reject) => {
    if (!helper) {
      reject(new Error('The screen share has ended.'));
      return;
    }
    waiters.push({ type, resolve, reject });
  });
}

function rejectWaiters(error: Error): void {
  const pending = waiters;
  waiters = [];
  for (const waiter of pending) {
    waiter.reject(error);
  }
}

function send(fields: string[]): void {
  if (fields.some((field) => /[\t\n]/.test(field))) {
    throw new Error('A screen share command cannot hold tabs or line breaks.');
  }
  helper?.stdin.write(`${fields.join('\t')}\n`);
}

/**
 * Shows the system share dialog for one screen and opens the share. Resolves 'picked' once its
 * picture arrives, 'cancelled' when the dialog was closed, and 'unavailable' when the helper
 * can't run here (the screen share then goes through Chromium, which shows the system pointer).
 */
export function pickWaylandScreen(): Promise<ScreenPick> {
  if (picking) {
    return picking;
  }
  endWaylandShare();

  const binary = helperPath();
  if (!fs.existsSync(binary)) {
    log.warn('[recording:wayland-share] helper not found', { binary });
    return Promise.resolve('unavailable');
  }

  share = null;
  shareEnded = false;
  recorded = null;
  lastPointer = null;
  const child = spawn(binary, [], { stdio: 'pipe' });
  helper = child;
  let screen: ShareScreen | null = null;

  picking = new Promise<ScreenPick>((resolve, reject) => {
    let settled = false;
    const settle = (result: ScreenPick | Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      picking = null;
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };
    const timeout = setTimeout(() => {
      log.warn('[recording:wayland-share] the share dialog never answered');
      endWaylandShare();
      settle('unavailable');
    }, PICK_TIMEOUT_MS);

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      const message = parseCaptureHelperLine(line);
      if (!message || helper !== child) {
        return;
      }
      switch (message.type) {
        case 'move':
          lastPointer = { x: message.x, y: message.y };
          moveListener?.(message.x, message.y);
          return;
        case 'ready':
          screen = message.screen;
          return;
        case 'video':
          if (screen && !share) {
            share = {
              screen,
              video: { width: message.width, height: message.height, format: message.format },
            };
            log.info('[recording:wayland-share] screen picked', share);
            settle('picked');
          }
          return;
        case 'recorded':
          recorded = { ok: message.ok, frames: message.frames, late: message.late };
          log.info('[recording:wayland-share] recording finished', recorded);
          break;
        case 'ended':
          shareEnded = true;
          log.info('[recording:wayland-share] the share ended');
          for (const listener of endedListeners) {
            listener();
          }
          return;
        case 'error':
          if (!settled) {
            log.warn('[recording:wayland-share] no screen picked', message);
            settle(
              message.code === 'cancelled'
                ? 'cancelled'
                : message.code === 'unsupported'
                  ? 'unavailable'
                  : new Error(message.message || 'The screen share did not start.'),
            );
            return;
          }
          log.warn('[recording:wayland-share] helper error', message);
          rejectWaiters(new Error(message.message || 'The screen share failed.'));
          return;
      }
      const index = waiters.findIndex((waiter) => waiter.type === message.type);
      if (index >= 0) {
        const [waiter] = waiters.splice(index, 1);
        waiter.resolve(message);
      }
    });
    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      log.warn('[recording:wayland-share] helper:', line);
    });
    child.on('error', (error) => {
      log.warn('[recording:wayland-share] helper could not run', error);
      // A helper that never started may send no 'close'.
      if (helper === child) {
        helper = null;
        rejectWaiters(new Error('The screen share has ended.'));
      }
      settle('unavailable');
    });
    // 'close', not 'exit': its last messages (the finished recording) are read by then.
    child.on('close', (code, signal) => {
      // Only this helper's own state: a newer pick may already have replaced it.
      if (helper === child) {
        helper = null;
        rejectWaiters(new Error('The screen share has ended.'));
        // Picked, then gone without saying the share ended: tell the app, so a recording stops.
        if (settled && share && !shareEnded) {
          shareEnded = true;
          log.warn('[recording:wayland-share] helper exited unexpectedly', { code, signal });
          for (const listener of endedListeners) {
            listener();
          }
        }
      }
      if (!settled) {
        log.warn('[recording:wayland-share] helper exited before a screen was picked', {
          code,
          signal,
        });
      }
      // It couldn't even ask (missing libraries, no portal): share through Chromium instead.
      settle('unavailable');
    });
  });
  return picking;
}

/** Starts writing the shared screen to `outPath`. */
export async function startWaylandShareRecording(
  ffmpegPath: string,
  outPath: string,
): Promise<{ fps: number }> {
  if (!hasWaylandShare() || !share) {
    throw new Error('The screen share has ended. Pick the screen again.');
  }
  const { fps, args } = buildShareRecordArgs(share.video, outPath);
  recorded = null;
  const started = waitFor('recording');
  send(['record', String(fps), ffmpegPath, ...args]);
  await started;
  return { fps };
}

export function pauseWaylandShareRecording(): void {
  send(['pause']);
}

export function resumeWaylandShareRecording(): void {
  send(['resume']);
}

/** Finishes the recording; already finished when the share ended on its own. */
export async function finishWaylandShareRecording(): Promise<ShareRecorded> {
  if (recorded) {
    return recorded;
  }
  if (!helper) {
    return { ok: false, frames: 0, late: 0 };
  }
  const done = waitFor('recorded');
  send(['stop']);
  try {
    await done;
  } catch {
    // The helper ended while finishing; FFmpeg still closes the file when its input ends.
  }
  return recorded ?? { ok: false, frames: 0, late: 0 };
}

/** The shared screen as it looks now, as a PNG, for drawing an area on. */
export async function getWaylandShareStill(): Promise<{
  png: Uint8Array;
  width: number;
  height: number;
}> {
  if (!hasWaylandShare()) {
    throw new Error('The screen share has ended.');
  }
  const stillPath = path.join(os.tmpdir(), `screenforge-still-${randomUUID()}.bgra`);
  try {
    const answer = waitFor('still');
    send(['still', stillPath]);
    const message = await answer;
    if (message.type !== 'still') {
      throw new Error('The screen could not be shown.');
    }
    const bitmap = await fs.promises.readFile(stillPath);
    const png = nativeImage
      .createFromBitmap(bitmap, { width: message.width, height: message.height })
      .toPNG();
    return { png: new Uint8Array(png), width: message.width, height: message.height };
  } finally {
    await fs.promises.rm(stillPath, { force: true });
  }
}

/** Lets the share go; the system's sharing indicator goes away with it. */
export function endWaylandShare(): void {
  const child = helper;
  helper = null;
  rejectWaiters(new Error('The screen share has ended.'));
  if (!child) {
    return;
  }
  // Closing stdin asks it to leave (finishing any recording); the signal is for a helper
  // still waiting on the dialog.
  child.stdin.end();
  child.kill('SIGTERM');
}
