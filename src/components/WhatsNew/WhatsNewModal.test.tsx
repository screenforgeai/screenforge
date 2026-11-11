import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGELOG_URL } from 'src/lib/siteLinks';
import type { ReleaseNotes } from 'src/lib/whatsNew/changelog';
import { WhatsNewModal } from './WhatsNewModal';

const openExternalUrl = vi.fn();

beforeEach(() => {
  openExternalUrl.mockReset();
  Object.defineProperty(window, 'screenforge', {
    value: { openExternalUrl },
    writable: true,
    configurable: true,
  });
});

afterEach(cleanup);

const v080: ReleaseNotes = {
  version: '0.8.0',
  newItems: [
    { text: 'Screenshot mode: take a screenshot of any window.', details: [] },
    { text: 'Add a What’s new dialog.', details: ['Opens once after each update'] },
  ],
  fixItems: [{ text: 'Exports work on 5K displays. They used to fail.', details: [] }],
};

const manyFixes: ReleaseNotes = {
  version: '0.9.0',
  newItems: [],
  fixItems: Array.from({ length: 6 }, (_, i) => ({ text: `Fix number ${i + 1}.`, details: [] })),
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
  it('shows the title, the version, titled features and then the fixes', () => {
    const { dialog } = renderModal([v080]);

    expect(within(dialog).getByRole('heading', { name: 'What’s new' })).toBeInTheDocument();
    expect(within(dialog).getByText('v0.8.0')).toBeInTheDocument();

    const featureTitle = within(dialog).getByRole('heading', { level: 4, name: 'Screenshot mode' });
    expect(within(dialog).getByText('Take a screenshot of any window.')).toBeInTheDocument();
    expect(within(dialog).getByText('Add a What’s new dialog')).toBeInTheDocument();
    expect(within(dialog).getByText('Opens once after each update')).toBeInTheDocument();

    const fixesLabel = within(dialog).getByRole('heading', { name: /Fixes and improvements/ });
    expect(
      featureTitle.compareDocumentPosition(fixesLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(dialog).getByText('Exports work on 5K displays.')).toBeInTheDocument();
    expect(within(dialog).getByText('They used to fail.')).toBeInTheDocument();
  });

  it('shows only the fixes when a release has no features', () => {
    const { dialog } = renderModal([v071]);

    expect(within(dialog).queryAllByRole('heading', { level: 4 })).toHaveLength(1);
    expect(
      within(dialog).getByRole('heading', { name: /Fixes and improvements/ }),
    ).toBeInTheDocument();
  });

  it('shows the first few fixes and the rest on request', async () => {
    const { dialog } = renderModal([manyFixes]);

    expect(within(dialog).getByText('Fix number 4.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Fix number 5.')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Show 2 more' }));

    expect(within(dialog).getByText('Fix number 6.')).toBeInTheDocument();
    // Focus lands on the first fix revealed, so the reader keeps their place.
    expect(within(dialog).getByText('Fix number 5.').closest('li')).toHaveFocus();
    expect(within(dialog).queryByRole('button', { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it('keeps focus at the release that was expanded, so Tab moves forward', async () => {
    const release = (version: string, label: string): ReleaseNotes => ({
      version,
      newItems: [],
      fixItems: Array.from({ length: 6 }, (_, i) => ({ text: `${label} ${i + 1}.`, details: [] })),
    });
    const { dialog } = renderModal([release('0.9.0', 'Newer fix'), release('0.8.0', 'Older fix')]);
    const [, olderShowMore] = within(dialog).getAllByRole('button', { name: 'Show 2 more' });

    await userEvent.click(olderShowMore);

    expect(within(dialog).getByText('Older fix 5.').closest('li')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Full changelog' })).toHaveFocus();
  });

  it('opens the full changelog on the website', async () => {
    renderModal([v080]);

    await userEvent.click(screen.getByRole('button', { name: 'Full changelog' }));

    expect(openExternalUrl).toHaveBeenCalledWith(CHANGELOG_URL);
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

  it('focuses the notes rather than a button, and Enter closes it', async () => {
    const { onClose } = renderModal([v080]);

    await waitFor(() =>
      expect(screen.getByText('Add a What’s new dialog').closest('[tabindex="0"]')).toHaveFocus(),
    );
    await userEvent.keyboard('{Enter}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from the header close button', async () => {
    const { onClose } = renderModal([v080]);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets keyboard users tab back to the notes to scroll them', async () => {
    renderModal([v080]);
    const notes = screen.getByText('Add a What’s new dialog').closest('[tabindex="0"]');

    await waitFor(() => expect(notes).toHaveFocus());
    await userEvent.tab();
    expect(notes).not.toHaveFocus();

    // Full changelog, Got it, then focus wraps to Close and back to the notes.
    for (let i = 0; i < 3; i += 1) {
      await userEvent.tab();
    }

    expect(notes).toHaveFocus();
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
