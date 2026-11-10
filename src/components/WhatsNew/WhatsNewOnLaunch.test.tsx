import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseNotes } from 'src/lib/whatsNew/changelog';
import { WhatsNewOnLaunch } from './WhatsNewOnLaunch';

vi.mock('src/lib/whatsNew/releaseNotes', () => ({
  getBundledReleases: (): ReleaseNotes[] => [
    { version: '0.8.0', newItems: [{ text: 'Eight', details: [] }], fixItems: [] },
    { version: '0.7.1', newItems: [], fixItems: [{ text: 'Seven one', details: [] }] },
    { version: '0.7.0', newItems: [{ text: 'Seven', details: [] }], fixItems: [] },
  ],
}));

const consume = vi.fn();

beforeEach(() => {
  consume.mockReset();
  Object.defineProperty(window, 'screenforge', {
    value: { consumeWhatsNewOnLaunch: consume },
    writable: true,
    configurable: true,
  });
});

afterEach(cleanup);

describe('WhatsNewOnLaunch', () => {
  it('opens with every release since the last seen version', async () => {
    consume.mockResolvedValue({ show: true, sinceVersion: '0.7.0', currentVersion: '0.8.0' });

    render(<WhatsNewOnLaunch />);

    expect(await screen.findByText('Eight')).toBeInTheDocument();
    expect(screen.getByText('Seven one')).toBeInTheDocument();
    expect(screen.queryByText('Seven')).not.toBeInTheDocument();
    expect(consume).toHaveBeenCalledTimes(1);
  });

  it('stays closed when the main process says not to show', async () => {
    consume.mockResolvedValue({ show: false, sinceVersion: '0.8.0', currentVersion: '0.8.0' });

    render(<WhatsNewOnLaunch />);

    await waitFor(() => expect(consume).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays closed when the changelog has nothing for this version', async () => {
    consume.mockResolvedValue({ show: true, sinceVersion: null, currentVersion: '0.8.1' });

    render(<WhatsNewOnLaunch />);

    await waitFor(() => expect(consume).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays closed if the check fails', async () => {
    consume.mockRejectedValue(new Error('ipc down'));

    render(<WhatsNewOnLaunch />);

    await waitFor(() => expect(consume).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when dismissed', async () => {
    consume.mockResolvedValue({ show: true, sinceVersion: '0.7.1', currentVersion: '0.8.0' });

    render(<WhatsNewOnLaunch />);
    await userEvent.click(await screen.findByRole('button', { name: 'Got it' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
