import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReleaseNotes } from 'src/lib/whatsNew/changelog';
import { WhatsNewModal } from './WhatsNewModal';

afterEach(cleanup);

const v080: ReleaseNotes = {
  version: '0.8.0',
  newItems: [{ text: 'Add a What’s new dialog.', details: ['Opens once after each update'] }],
  fixItems: [{ text: 'Exports work on 5K displays.', details: [] }],
};

const v071: ReleaseNotes = {
  version: '0.7.1',
  newItems: [],
  fixItems: [{ text: '<img src=x onerror=alert(1)> stays text', details: [] }],
};

const renderModal = (releases: ReleaseNotes[], onClose = vi.fn()) => {
  render(<WhatsNewModal open releases={releases} onClose={onClose} />);
  return { onClose, dialog: screen.getByRole('dialog') };
};

describe('WhatsNewModal', () => {
  it('shows the title, the version and the notes with New before fixes', () => {
    const { dialog } = renderModal([v080]);

    expect(within(dialog).getByRole('heading', { name: 'What’s new' })).toBeInTheDocument();
    expect(within(dialog).getByText('v0.8.0')).toBeInTheDocument();

    const newLabel = within(dialog).getByText('New');
    const fixesLabel = within(dialog).getByText('Fixes and improvements');
    expect(newLabel.compareDocumentPosition(fixesLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(dialog).getByText('Add a What’s new dialog.')).toBeInTheDocument();
    expect(within(dialog).getByText('Opens once after each update')).toBeInTheDocument();
    expect(within(dialog).getByText('Exports work on 5K displays.')).toBeInTheDocument();
  });

  it('omits a section with no entries', () => {
    const { dialog } = renderModal([v071]);

    expect(within(dialog).queryByText('New')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Fixes and improvements')).toBeInTheDocument();
  });

  it('renders entry text literally, never as HTML', () => {
    const { dialog } = renderModal([v071]);

    expect(within(dialog).getByText('<img src=x onerror=alert(1)> stays text')).toBeInTheDocument();
    expect(dialog.querySelector('img')).toBeNull();
  });

  it('groups several versions newest first, each with its own label', () => {
    const { dialog } = renderModal([v080, v071]);

    const labels = within(dialog)
      .getAllByRole('heading', { level: 3 })
      .map((el) => el.textContent);
    expect(labels).toEqual(['Version 0.8.0', 'Version 0.7.1']);
    expect(within(dialog).getByText('v0.8.0')).toBeInTheDocument();
  });

  it('closes from the Got it button', async () => {
    const { onClose } = renderModal([v080]);

    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses Got it on open so Enter closes it', async () => {
    const { onClose } = renderModal([v080]);
    const button = screen.getByRole('button', { name: 'Got it' });

    await waitFor(() => expect(button).toHaveFocus());
    await userEvent.keyboard('{Enter}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const { onClose } = renderModal([v080]);

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    render(<WhatsNewModal open={false} releases={[v080]} onClose={vi.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
