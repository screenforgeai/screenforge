import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorAccountState, ShareJobState } from 'src/types';
import { SharePanel } from './SharePanel';

const openSettings = vi.fn();
vi.mock('src/lib/settingsNavigation', () => ({
  openSettings: (section: string) => openSettings(section),
}));

const SIGNED_IN: DirectorAccountState = {
  status: 'signed-in',
  user: { id: 'u1', email: 'mohib@screenforge.co' },
  workspace: { id: 'w1', name: 'Screenforge' },
  remembered: true,
};

let pushState: (state: ShareJobState) => void = () => undefined;
const api = {
  getDirectorAccount: vi.fn(),
  onDirectorAccountChanged: vi.fn(() => vi.fn()),
  getShareState: vi.fn(),
  onShareStateChanged: vi.fn((cb: (state: ShareJobState) => void) => {
    pushState = cb;
    return vi.fn();
  }),
  canResumeShare: vi.fn(),
  shareVideo: vi.fn(),
  cancelShare: vi.fn().mockResolvedValue(undefined),
  copyShareLink: vi.fn().mockResolvedValue(true),
  openExternalUrl: vi.fn(),
};

const FILE = '/exports/demo.mp4';

const renderPanel = ({
  account = SIGNED_IN,
  format = 'mp4' as const,
}: { account?: DirectorAccountState; format?: 'mp4' | 'webm' | 'mov' | 'gif' } = {}) => {
  api.getDirectorAccount.mockResolvedValue(account);
  render(<SharePanel filePath={FILE} format={format} durationS={42} title="Demo" projectId="p1" />);
};

beforeEach(() => {
  Object.defineProperty(window, 'screenforge', { value: api, writable: true, configurable: true });
  api.getShareState.mockResolvedValue({ status: 'idle' });
  api.canResumeShare.mockResolvedValue(false);
  api.shareVideo.mockResolvedValue({ status: 'idle' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SharePanel', () => {
  it('shares the exported file in one click, and explains the free plan', async () => {
    renderPanel();
    expect(await screen.findByText(/links last 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/25 active links/i)).toBeInTheDocument();
    expect(screen.getByText(/paid plans keep links forever/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /share link/i }));
    expect(api.shareVideo).toHaveBeenCalledWith({
      filePath: FILE,
      projectId: 'p1',
      title: 'Demo',
      durationS: 42,
    });
  });

  it('offers to resume an upload that stopped', async () => {
    api.canResumeShare.mockResolvedValue(true);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /resume upload/i }));
    expect(api.shareVideo).toHaveBeenCalled();
  });

  it('shows upload progress with a Cancel button', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /share link/i });
    act(() =>
      pushState({
        status: 'uploading',
        filePath: FILE,
        projectId: 'p1',
        uploadedBytes: 15_000_000,
        totalBytes: 30_000_000,
      }),
    );
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText(/15 MB of 30 MB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(api.cancelShare).toHaveBeenCalled();
  });

  it('says the link was copied, shows it and when it expires', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /share link/i });
    act(() =>
      pushState({
        status: 'done',
        filePath: FILE,
        projectId: 'p1',
        copied: true,
        link: {
          shareId: 's1',
          title: 'Demo',
          watchUrl: 'https://director.screenforge.co/s/s1',
          expiresAt: '2099-12-06T10:00:00.000Z',
          status: 'live',
          sharedAt: null,
        },
      }),
    );
    expect(screen.getByText(/link copied/i)).toBeInTheDocument();
    expect(screen.getByText('https://director.screenforge.co/s/s1')).toBeInTheDocument();
    expect(screen.getByText(/^expires /i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect(api.copyShareLink).toHaveBeenCalledWith('p1');
  });

  it('says a paid-plan link never expires', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /share link/i });
    act(() =>
      pushState({
        status: 'done',
        filePath: FILE,
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
      }),
    );
    expect(screen.getByText(/never expires/i)).toBeInTheDocument();
  });

  it('explains the free-plan limits Director enforces', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /share link/i });
    act(() =>
      pushState({
        status: 'failed',
        filePath: FILE,
        projectId: 'p1',
        error: 'too-long',
        resumable: false,
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/up to 10 minutes/i);
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    act(() =>
      pushState({
        status: 'failed',
        filePath: FILE,
        projectId: 'p1',
        error: 'limit-reached',
        resumable: false,
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/25 active links/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('offers to resume after the network dropped', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /share link/i });
    act(() =>
      pushState({
        status: 'failed',
        filePath: FILE,
        projectId: 'p1',
        error: 'interrupted',
        resumable: true,
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/interrupted/i);
    fireEvent.click(screen.getByRole('button', { name: /resume upload/i }));
    expect(api.shareVideo).toHaveBeenCalled();
  });

  it('asks to sign in again when Director signed the app out', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /share link/i });
    act(() =>
      pushState({
        status: 'failed',
        filePath: FILE,
        projectId: 'p1',
        error: 'signed-out',
        resumable: true,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /sign in again/i }));
    expect(openSettings).toHaveBeenCalledWith('director');
  });

  it('when signed out, explains the optional sign-in and opens Settings › Director', async () => {
    renderPanel({ account: { status: 'signed-out' } });
    expect(await screen.findByText(/optional director sign-in/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sign in to director/i }));
    expect(openSettings).toHaveBeenCalledWith('director');
    expect(api.shareVideo).not.toHaveBeenCalled();
  });

  it.each(['gif', 'mov'] as const)('explains that a %s export cannot be shared', async (format) => {
    renderPanel({ format });
    expect(await screen.findByText(/only mp4 and webm/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /share link/i })).not.toBeInTheDocument();
  });

  it('ignores progress from a different file', async () => {
    renderPanel();
    await screen.findByRole('button', { name: /share link/i });
    act(() =>
      pushState({
        status: 'uploading',
        filePath: '/exports/other.mp4',
        projectId: 'p2',
        uploadedBytes: 1,
        totalBytes: 2,
      }),
    );
    expect(screen.getByRole('button', { name: /share link/i })).toBeInTheDocument();
  });
});
