import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseNotes } from 'src/lib/whatsNew/changelog';
import { WhatsNewButton } from './WhatsNewButton';

vi.mock('src/lib/whatsNew/releaseNotes', () => ({
  getBundledReleases: (): ReleaseNotes[] => [
    { version: '0.8.0', newItems: [{ text: 'Eight', details: [] }], fixItems: [] },
    { version: '0.7.0', newItems: [{ text: 'Seven', details: [] }], fixItems: [] },
  ],
}));

const getAppVersion = vi.fn();

beforeEach(() => {
  getAppVersion.mockReset();
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

  it('falls back to the newest notes if the version is unavailable', async () => {
    getAppVersion.mockRejectedValue(new Error('no ipc'));
    renderButton();

    await userEvent.click(screen.getByRole('button', { name: 'What’s new' }));

    expect(await screen.findByText('Eight')).toBeInTheDocument();
  });
});
