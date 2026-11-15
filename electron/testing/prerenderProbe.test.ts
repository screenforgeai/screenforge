// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportPrerenderStatus } from '../../src/types';
import { CH } from '../channels';

const mocks = vi.hoisted(() => {
  const statusListeners = new Set<(event: unknown, status: ExportPrerenderStatus) => void>();
  // When each frame-time read happened (fake clock), in order.
  const takes: number[] = [];
  let stopPending: (() => void) | null = null;
  return {
    statusListeners,
    takes,
    emit(phase: ExportPrerenderStatus['phase']) {
      for (const listener of statusListeners) {
        listener({}, { phase, total: 10, cached: 0, stateVersion: 0 });
      }
    },
    runExportPrerender: vi.fn(
      () =>
        // Runs until the probe stops it; the stop makes it report false.
        new Promise<boolean>((resolve) => {
          stopPending = () => resolve(false);
        }),
    ),
    stopExportPrerender: vi.fn(() => {
      stopPending?.();
      stopPending = null;
    }),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = {
      executeJavaScript: vi.fn(async () => {
        mocks.takes.push(Date.now());
        return [16, 17, 16];
      }),
    };
    loadURL = vi.fn(async () => undefined);
    destroy = vi.fn();
  },
  ipcMain: {
    on: vi.fn((channel: string, listener: never) => {
      if (channel === CH.export.PRERENDER_STATUS) {
        mocks.statusListeners.add(listener);
      }
    }),
    off: vi.fn((_channel: string, listener: never) => {
      mocks.statusListeners.delete(listener);
    }),
  },
}));

vi.mock('node:fs/promises', () => ({
  default: { rm: vi.fn(async () => undefined), readdir: vi.fn(async () => []) },
}));

vi.mock('../modules/export/service', () => ({
  runExportPrerender: mocks.runExportPrerender,
  stopExportPrerender: mocks.stopExportPrerender,
}));

import { runPrerenderProbe } from './prerenderProbe';

const PHASE_MS = 1000;

/** Runs the probe on the fake clock until it returns. */
async function probe() {
  let done = false;
  const result = runPrerenderProbe({} as never, '/p.js', '/cache', [0.5], PHASE_MS).finally(() => {
    done = true;
  });
  for (let i = 0; i < 5000 && !done; i++) {
    await vi.advanceTimersByTimeAsync(100);
  }
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.takes.length = 0;
  mocks.statusListeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('runPrerenderProbe', () => {
  it('waits for a slow-loading pre-render to start rendering before measuring', async () => {
    let startedAt = 0;
    mocks.runExportPrerender.mockImplementationOnce(() => {
      startedAt = Date.now();
      // The hidden window takes 10 s to load before frames are encoded.
      setTimeout(() => mocks.emit('rendering'), 10_000);
      return new Promise<boolean>((resolve) => {
        mocks.stopExportPrerender.mockImplementationOnce(() => resolve(false));
      });
    });

    const [, phase] = await probe();

    // Reads 1–2 measure the editor alone; read 3 starts the pre-render phase.
    expect(mocks.takes[2] - startedAt).toBeGreaterThanOrEqual(10_000);
    expect(phase.skipped).toBeUndefined();
    expect(phase.frames).toBe(3);
    // Our own stop ends it, and that is not a refusal.
    expect(mocks.stopExportPrerender).toHaveBeenCalledTimes(1);
  });

  it('skips the phase when the pre-render never starts rendering', async () => {
    mocks.runExportPrerender.mockImplementationOnce(async () => false);

    const [, phase] = await probe();

    expect(phase.skipped).toBe('pre-render never started rendering');
  });

  it('skips the phase when capture ends while measuring, before cleanup', async () => {
    mocks.runExportPrerender.mockImplementationOnce(() => {
      setTimeout(() => mocks.emit('rendering'), 500);
      // 'done' arrives mid-measurement; the run itself is still cleaning up.
      setTimeout(() => mocks.emit('done'), 500 + PHASE_MS / 2 + 200);
      return new Promise<boolean>((resolve) => {
        mocks.stopExportPrerender.mockImplementationOnce(() => resolve(true));
      });
    });

    const [, phase] = await probe();

    expect(phase.skipped).toBe('pre-render finished while measuring');
  });

  it('stops listening for status once done', async () => {
    mocks.runExportPrerender.mockImplementationOnce(async () => false);
    await probe();
    expect(mocks.statusListeners.size).toBe(0);
  });
});
