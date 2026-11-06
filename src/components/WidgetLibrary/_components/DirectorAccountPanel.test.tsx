import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorAccountState } from 'src/types';
import { DirectorAccountPanel } from './DirectorAccountPanel';

const api = {
  getDirectorAccount: vi.fn(),
  onDirectorAccountChanged: vi.fn(() => vi.fn()),
  signInToDirector: vi.fn().mockResolvedValue(undefined),
  cancelDirectorSignIn: vi.fn().mockResolvedValue(undefined),
  signOutOfDirector: vi.fn().mockResolvedValue(undefined),
  openExternalUrl: vi.fn(),
};

const showing = (state: DirectorAccountState) => {
  api.getDirectorAccount.mockResolvedValue(state);
  render(<DirectorAccountPanel />);
};

beforeEach(() => {
  Object.defineProperty(window, 'screenforge', { value: api, writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DirectorAccountPanel', () => {
  it('explains what signing in adds, and that it is optional', async () => {
    showing({ status: 'signed-out' });
    expect(await screen.findByText(/share videos as links/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sign in with director/i }));
    expect(api.signInToDirector).toHaveBeenCalled();
  });

  it('says to approve in the browser while waiting, and can cancel or reopen the page', async () => {
    showing({
      status: 'signing-in',
      approveUrl: 'https://director.screenforge.co/desktop-login/C',
    });
    expect(await screen.findByText(/approve the sign-in in your browser/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open the page again/i }));
    expect(api.openExternalUrl).toHaveBeenCalledWith(
      'https://director.screenforge.co/desktop-login/C',
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(api.cancelDirectorSignIn).toHaveBeenCalled();
  });

  it('shows who is signed in to which workspace, and signs out', async () => {
    showing({
      status: 'signed-in',
      user: { id: 'u', email: 'mohib@screenforge.co' },
      workspace: { id: 'w', name: 'Screenforge' },
      remembered: true,
    });
    expect(await screen.findByText(/mohib@screenforge\.co/)).toBeInTheDocument();
    expect(screen.getByText(/Screenforge$/)).toBeInTheDocument();
    expect(screen.queryByText(/sign in again after quitting/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(api.signOutOfDirector).toHaveBeenCalled());
  });

  it("warns when the sign-in can't be remembered", async () => {
    showing({
      status: 'signed-in',
      user: { id: 'u', email: 'a@b.co' },
      workspace: { id: 'w', name: null },
      remembered: false,
    });
    expect(await screen.findByText(/sign in again after quitting/i)).toBeInTheDocument();
  });

  it.each([
    ['expired', /link expired/i],
    ['failed', /couldn.t sign in/i],
    ['disconnected', /disconnected from director/i],
  ] as const)('explains a %s sign-in', async (error, text) => {
    showing({ status: 'signed-out', error });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});
