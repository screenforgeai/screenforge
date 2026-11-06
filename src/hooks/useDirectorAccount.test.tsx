import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorAccountState } from '../types';
import { useDirectorAccount } from './useDirectorAccount';

let listener: ((state: DirectorAccountState) => void) | null = null;
const unsubscribe = vi.fn();

beforeEach(() => {
  listener = null;
  Object.defineProperty(window, 'screenforge', {
    value: {
      getDirectorAccount: vi.fn().mockResolvedValue({ status: 'signed-out' }),
      onDirectorAccountChanged: vi.fn((cb: (state: DirectorAccountState) => void) => {
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

describe('useDirectorAccount', () => {
  it('reads the current sign-in, then follows changes', async () => {
    const { result } = renderHook(() => useDirectorAccount());
    await waitFor(() => expect(result.current).toEqual({ status: 'signed-out' }));

    act(() =>
      listener?.({
        status: 'signed-in',
        user: { id: 'u', email: 'a@b.co' },
        workspace: { id: 'w', name: 'W' },
        remembered: true,
      }),
    );
    expect(result.current).toMatchObject({ status: 'signed-in' });
  });

  it('keeps a pushed change over a slower snapshot', async () => {
    let resolve: (s: DirectorAccountState) => void = () => undefined;
    vi.mocked(window.screenforge.getDirectorAccount).mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result } = renderHook(() => useDirectorAccount());
    act(() => listener?.({ status: 'signing-in', approveUrl: 'https://x' }));
    await act(async () => resolve({ status: 'signed-out' }));
    expect(result.current).toEqual({ status: 'signing-in', approveUrl: 'https://x' });
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useDirectorAccount());
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
