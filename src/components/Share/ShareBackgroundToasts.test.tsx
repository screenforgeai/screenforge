import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareJobState } from 'src/types';
import { ShareBackgroundToasts } from './ShareBackgroundToasts';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

let push: (state: ShareJobState) => void = () => undefined;
const api = {
  getShareState: vi.fn(),
  onShareStateChanged: vi.fn((cb: (state: ShareJobState) => void) => {
    push = cb;
    return vi.fn();
  }),
};

const uploading: ShareJobState = {
  status: 'uploading',
  filePath: '/e/demo.mp4',
  projectId: 'p1',
  uploadedBytes: 1,
  totalBytes: 2,
};
const done: ShareJobState = {
  status: 'done',
  filePath: '/e/demo.mp4',
  projectId: 'p1',
  copied: true,
  link: {
    shareId: 's1',
    title: 'Demo',
    watchUrl: 'https://director.screenforge.co/s/s1',
    expiresAt: null,
    status: 'live',
    sharedAt: null,
  },
};

beforeEach(() => {
  Object.defineProperty(window, 'screenforge', { value: api, writable: true, configurable: true });
  api.getShareState.mockResolvedValue({ status: 'idle' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ShareBackgroundToasts', () => {
  it('says the link was copied when an upload finishes out of sight', () => {
    render(<ShareBackgroundToasts shownFilePath={null} />);
    act(() => push(uploading));
    act(() => push(done));
    expect(toast.success).toHaveBeenCalledWith('Share link copied', {
      description: 'https://director.screenforge.co/s/s1',
    });
  });

  it('explains a failure that happens out of sight', () => {
    render(<ShareBackgroundToasts shownFilePath={null} />);
    act(() => push(uploading));
    act(() =>
      push({
        ...uploading,
        status: 'failed',
        error: 'interrupted',
        resumable: true,
      } as ShareJobState),
    );
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/interrupted/i));
  });

  it('stays quiet while the export window shows the share itself, and for old results', () => {
    const { rerender } = render(<ShareBackgroundToasts shownFilePath="/e/demo.mp4" />);
    act(() => push(uploading));
    act(() => push(done));
    rerender(<ShareBackgroundToasts shownFilePath={null} />);
    act(() => push(done));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('still reports a share the export window is not showing', () => {
    render(<ShareBackgroundToasts shownFilePath="/e/other.mp4" />);
    act(() => push(uploading));
    act(() => push(done));
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
