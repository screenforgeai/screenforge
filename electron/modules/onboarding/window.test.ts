// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => {
  type Listener = () => void;
  class FakeWindow {
    static instances: FakeWindow[] = [];
    private listeners = new Map<string, Listener[]>();
    constructor() {
      FakeWindow.instances.push(this);
    }
    on(event: string, listener: Listener) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }
    once(event: string, listener: Listener) {
      return this.on(event, listener);
    }
    emit(event: string) {
      for (const listener of this.listeners.get(event) ?? []) {
        listener();
      }
    }
    close() {
      this.emit('closed');
    }
    isDestroyed() {
      return false;
    }
    getContentSize() {
      return [600, 568];
    }
    setContentSize() {
      return undefined;
    }
    show() {
      return undefined;
    }
    focus() {
      return undefined;
    }
  }
  return { FakeWindow, completeOnboarding: vi.fn<[], Promise<void>>() };
});

vi.mock('electron', () => ({ BrowserWindow: fakes.FakeWindow }));
vi.mock('./service', () => ({ completeOnboarding: fakes.completeOnboarding }));
vi.mock('../../lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));

import { finishOnboardingWindow, markOnboardingResumePending, runOnboardingWindow } from './window';

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

// Lets queued promise callbacks run.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = () => {
  const outcome = runOnboardingWindow({
    preloadPath: 'preload.js',
    loadURL: vi.fn(),
    resumeStep: null,
  });
  const win = fakes.FakeWindow.instances[fakes.FakeWindow.instances.length - 1];
  const state = { settled: null as string | null };
  void outcome.then((value) => {
    state.settled = value;
  });
  return { win, state };
};

describe('onboarding window lifecycle', () => {
  beforeEach(() => {
    fakes.completeOnboarding.mockReset();
  });

  it('a close during the window’s own completion write waits for that write', async () => {
    const write = deferred();
    fakes.completeOnboarding.mockReturnValue(write.promise);
    const { win, state } = open();

    const finishing = finishOnboardingWindow('record');
    win.emit('closed'); // closed from the system while the write is still in flight
    await flush();
    expect(state.settled).toBeNull();

    write.resolve();
    await finishing;
    await flush();
    expect(state.settled).toBe('record');
    expect(fakes.completeOnboarding).toHaveBeenCalledTimes(1);
  });

  it('a close from the system records completion before the editor starts', async () => {
    const write = deferred();
    fakes.completeOnboarding.mockReturnValue(write.promise);
    const { win, state } = open();

    win.emit('closed');
    await flush();
    expect(state.settled).toBeNull();

    write.resolve();
    await flush();
    expect(state.settled).toBe('editor');
  });

  it('quitting to reopen records nothing and settles at once', async () => {
    const { win, state } = open();
    markOnboardingResumePending();

    win.emit('closed');
    await flush();
    expect(state.settled).toBe('editor');
    expect(fakes.completeOnboarding).not.toHaveBeenCalled();
  });
});
