import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectShareLink, ShareLibrary } from 'src/types';
import { useShareLibrary } from './useShareLibrary';

const link = (status: 'live' | 'expired'): ProjectShareLink => ({
  shareId: 's1',
  title: 'Demo',
  watchUrl: 'https://director.screenforge.co/s/s1',
  expiresAt: '2026-12-06T10:00:00.000Z',
  status,
  sharedAt: null,
});

let push: (library: ShareLibrary) => void = () => undefined;
const api = {
  getShareLibrary: vi.fn(),
  refreshShareLibrary: vi.fn(),
  onShareLibraryChanged: vi.fn((cb: (library: ShareLibrary) => void) => {
    push = cb;
    return vi.fn();
  }),
};

beforeEach(() => {
  Object.defineProperty(window, 'screenforge', { value: api, writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useShareLibrary', () => {
  it('shows the saved links, then refreshes them from Director', async () => {
    api.getShareLibrary.mockResolvedValue({ links: { p1: link('live') }, pending: {} });
    api.refreshShareLibrary.mockResolvedValue({ links: { p1: link('expired') }, pending: {} });
    const { result } = renderHook(() => useShareLibrary());
    await waitFor(() => expect(result.current.links.p1?.status).toBe('expired'));
    expect(api.refreshShareLibrary).toHaveBeenCalledTimes(1);
  });

  it('follows changes the main process pushes', async () => {
    api.getShareLibrary.mockResolvedValue({ links: {}, pending: {} });
    api.refreshShareLibrary.mockResolvedValue({ links: {}, pending: {} });
    const { result } = renderHook(() => useShareLibrary());
    await waitFor(() => expect(api.refreshShareLibrary).toHaveBeenCalled());
    act(() => push({ links: { p2: link('live') }, pending: {} }));
    expect(result.current.links.p2?.shareId).toBe('s1');
  });
});
