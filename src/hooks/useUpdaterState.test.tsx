import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdaterState } from '../types';
import { useUpdaterState } from './useUpdaterState';

const idleState: UpdaterState = {
  currentVersion: '0.2.0',
  status: 'idle',
};

const readyState: UpdaterState = {
  currentVersion: '0.2.0',
  status: 'ready',
  availableVersion: '0.2.1',
};

let getUpdaterState: ReturnType<typeof vi.fn>;
let onUpdaterStateChanged: ReturnType<typeof vi.fn>;
let stateListener: ((state: UpdaterState) => void) | null = null;

beforeEach(() => {
  stateListener = null;
  getUpdaterState = vi.fn();
  onUpdaterStateChanged = vi.fn((listener: (state: UpdaterState) => void) => {
    stateListener = listener;
    return vi.fn();
  });

  Object.defineProperty(window, 'screenforge', {
    value: {
      getUpdaterState,
      onUpdaterStateChanged,
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useUpdaterState', () => {
  it('subscribes before reading the snapshot and keeps newer pushed state', async () => {
    let resolveSnapshot: ((state: UpdaterState) => void) | null = null;
    const snapshotPromise = new Promise<UpdaterState>((resolve) => {
      resolveSnapshot = resolve;
    });
    getUpdaterState.mockReturnValue(snapshotPromise);

    const { result } = renderHook(() => useUpdaterState());

    expect(onUpdaterStateChanged).toHaveBeenCalledOnce();
    expect(getUpdaterState).toHaveBeenCalledOnce();
    expect(onUpdaterStateChanged.mock.invocationCallOrder[0]).toBeLessThan(
      getUpdaterState.mock.invocationCallOrder[0],
    );

    act(() => {
      stateListener?.(readyState);
    });
    expect(result.current).toEqual(readyState);

    await act(async () => {
      resolveSnapshot?.(idleState);
      await snapshotPromise;
    });

    expect(result.current).toEqual(readyState);
  });
});
