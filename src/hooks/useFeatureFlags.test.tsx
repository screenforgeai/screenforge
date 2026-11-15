import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureFlags } from '../types';
import { useFeatureFlags } from './useFeatureFlags';

let listener: ((flags: FeatureFlags) => void) | null = null;
const unsubscribe = vi.fn();
const getFeatureFlags = vi.fn();

beforeEach(() => {
  listener = null;
  getFeatureFlags.mockResolvedValue({ directorSharing: true });
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
    expect(result.current).toEqual({ directorSharing: false });
    await waitFor(() => expect(result.current).toEqual({ directorSharing: true }));

    act(() => listener?.({ directorSharing: false }));
    expect(result.current).toEqual({ directorSharing: false });

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('stays off when the flags cannot be read', async () => {
    getFeatureFlags.mockRejectedValue(new Error('no handler'));
    const { result } = renderHook(() => useFeatureFlags());
    await waitFor(() => expect(getFeatureFlags).toHaveBeenCalled());
    expect(result.current).toEqual({ directorSharing: false });
  });
});
