import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureFlags } from '../types';
import { useFeatureFlags } from './useFeatureFlags';

let listener: ((flags: FeatureFlags) => void) | null = null;
const unsubscribe = vi.fn();
const getFeatureFlags = vi.fn();

beforeEach(() => {
  listener = null;
  getFeatureFlags.mockResolvedValue({ directorSharing: true, chunkedExport: true, betaUpdates: true });
  Object.defineProperty(window, 'screenforge', {
    value: {
      getFeatureFlags,
      onFeatureFlagsChanged: vi.fn((cb: (flags: FeatureFlags) => void) => {
        listener = cb;
        return unsubscribe;
      }),
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useFeatureFlags', () => {
  it('starts with everything off, reads the flags, then follows changes', async () => {
    const { result, unmount } = renderHook(() => useFeatureFlags());
    expect(result.current).toEqual({
      directorSharing: false,
      chunkedExport: false,
      betaUpdates: false,
    });
    await waitFor(() =>
      expect(result.current).toEqual({ directorSharing: true, chunkedExport: true, betaUpdates: true }),
    );

    const next = { directorSharing: false, chunkedExport: true, betaUpdates: false };
    act(() => listener?.(next));
    expect(result.current).toEqual(next);

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('stays off when the flags cannot be read', async () => {
    getFeatureFlags.mockRejectedValue(new Error('no handler'));
    const { result } = renderHook(() => useFeatureFlags());
    await waitFor(() => expect(getFeatureFlags).toHaveBeenCalled());
    expect(result.current).toEqual({
      directorSharing: false,
      chunkedExport: false,
      betaUpdates: false,
    });
  });
});
