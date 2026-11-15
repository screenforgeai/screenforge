import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorAccountState, ShareJobState } from 'src/types';
import { SharePanel } from './SharePanel';

const openSettings = vi.fn();
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

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
let pushAccount: (state: DirectorAccountState) => void = () => undefined;
const api = {
  getDirectorAccount: vi.fn(),
  onDirectorAccountChanged: vi.fn((cb: (state: DirectorAccountState) => void) => {
    pushAccount = cb;
    return vi.fn();
  }),
  getShareState: vi.fn(),
  onShareStateChanged: vi.fn((cb: (state: ShareJobState) => void) => {
    pushState = cb;
    return vi.fn();
  }),
  canResumeShare: vi.fn(),
  shareVideo: vi.fn(),
  cancelShare: vi.fn().mockResolvedValue(undefined),
  signInToDirector: vi.fn().mockResolvedValue(undefined),
  cancelDirectorSignIn: vi.fn().mockResolvedValue(undefined),
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
  it('shares the exported file in one click, with one short line about free links', async () => {
    renderPanel();
    expect(
      await screen.findByText('Anyone with the link can watch. Free links last 30 days.'),
    ).toBeInTheDocument();
    // The other free-plan limits only show up as errors, when they're hit.
    expect(screen.queryByText(/25 active links/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'What is Screenforge Director?' }),
    ).toBeInTheDocument();
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

  it.each([
    ['expired', 'Link expired'],
    ['removed', 'Link removed'],
  ] as const)(
    'says a %s link is no longer up, never that it lasts forever',
    async (status, text) => {
      renderPanel();
      await screen.findByRole('button', { name: /share link/i });
      act(() =>
        pushState({
          status: 'done',
          filePath: FILE,
          projectId: 'p1',
          copied: false,
          link: {
            shareId: 's1',
            title: 'Demo',
            watchUrl: null,
            expiresAt: null,
            status,
            sharedAt: null,
          },
        }),
      );
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.queryByText(/never expires/i)).not.toBeInTheDocument();
    },
  );

  it('says so when the link could not be copied', async () => {
    api.copyShareLink.mockResolvedValueOnce(false);
    renderPanel();
    await screen.findByRole('button', { name: /share link/i });
    act(() =>
      pushState({
        status: 'done',
        filePath: FILE,
        projectId: 'p1',
        copied: false,
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
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't copy the link."));
    expect(toast.success).not.toHaveBeenCalled();
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

  it('once signed in again after Director signed the app out, offers to resume the upload', async () => {
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
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
    // The account is signed in again, so the old "signed out" message is gone.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /resume upload/i }));
    expect(api.shareVideo).toHaveBeenCalled();
    expect(api.signInToDirector).not.toHaveBeenCalled();
  });

  it('when signed out, is one row whose Sign in signs in right here', async () => {
    renderPanel({ account: { status: 'signed-out' } });
    const signIn = await screen.findByRole('button', { name: 'Sign in' });
    expect(signIn.querySelector('svg[data-director-mark][aria-hidden="true"]')).not.toBeNull();
    // No line under the row.
    expect(screen.getByRole('region', { name: 'Share a link' }).querySelector('p')).toBeNull();

    fireEvent.click(signIn);
    expect(api.signInToDirector).toHaveBeenCalled();
    expect(openSettings).not.toHaveBeenCalled();
    expect(api.shareVideo).not.toHaveBeenCalled();
  });

  it('while signing in, announces the wait in a status region already there, and can be cancelled', async () => {
    renderPanel({ account: { status: 'signed-out' } });
    await screen.findByRole('button', { name: 'Sign in' });
    const region = screen.getByTestId('share-status');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toBeEmptyDOMElement();

    act(() =>
      pushAccount({
        status: 'signing-in',
        approveUrl: 'https://director.screenforge.co/desktop-login/X',
      }),
    );

    // The same region, mounted before the text arrived (WAI ARIA22).
    expect(screen.getByTestId('share-status')).toBe(region);
    expect(region).toHaveTextContent('Approve in your browser');
    expect(region).not.toContainElement(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(api.cancelDirectorSignIn).toHaveBeenCalled();
  });

  it('says why a sign-in from here failed, under the row', async () => {
    renderPanel({ account: { status: 'signed-out', error: 'expired' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The sign-in link expired. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
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
