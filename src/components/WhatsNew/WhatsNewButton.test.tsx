import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseNotes } from 'src/lib/whatsNew/changelog';
import { WhatsNewButton } from './WhatsNewButton';

const DEFAULT_RELEASES: ReleaseNotes[] = [
  { version: '0.8.0', newItems: [{ text: 'Eight', details: [] }], fixItems: [] },
  { version: '0.7.0', newItems: [{ text: 'Seven', details: [] }], fixItems: [] },
];

const releasesMock = vi.hoisted(() => vi.fn());

vi.mock('src/lib/whatsNew/releaseNotes', () => ({
  getBundledReleases: releasesMock,
}));

const getAppVersion = vi.fn();

beforeEach(() => {
  getAppVersion.mockReset();
  releasesMock.mockReturnValue(DEFAULT_RELEASES);
  Object.defineProperty(window, 'screenforge', {
    value: { getAppVersion },
    writable: true,
    configurable: true,
  });
});

afterEach(cleanup);

const renderButton = () => render(<WhatsNewButton />);

describe('WhatsNewButton', () => {
  it('opens the notes for the running version', async () => {
    getAppVersion.mockResolvedValue('0.7.0');
    renderButton();

    await userEvent.click(screen.getByRole('button', { name: 'What’s new' }));

    expect(await screen.findByText('Seven')).toBeInTheDocument();
    expect(screen.queryByText('Eight')).not.toBeInTheDocument();
  });

  it('does not open an empty dialog when no release has notes', async () => {
    getAppVersion.mockResolvedValue('0.1.0');
    releasesMock.mockReturnValue([{ version: '0.9.0', newItems: [], fixItems: [] }]);
    renderButton();

    await userEvent.click(screen.getByRole('button', { name: 'What’s new' }));

    await waitFor(() => expect(getAppVersion).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('falls back to the newest notes if the version is unavailable', async () => {
    getAppVersion.mockRejectedValue(new Error('no ipc'));
    renderButton();

    await userEvent.click(screen.getByRole('button', { name: 'What’s new' }));

    expect(await screen.findByText('Eight')).toBeInTheDocument();
  });
});
