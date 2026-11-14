import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateReadyPrompt } from './UpdateReadyPrompt';
import type { UpdaterState } from 'src/types';

const readyState: UpdaterState = {
  currentVersion: '0.0.22',
  status: 'ready',
  availableVersion: '0.0.23',
  releaseNotes: 'Fixes and polish',
};

const TITLE_RE = /restart when you.re done here/i;

afterEach(() => {
  cleanup();
});

describe('UpdateReadyPrompt', () => {
  it('auto-opens once per ready version and stays dismissed after Later', async () => {
    const onApply = vi.fn().mockResolvedValue(true);
    const onCheckNow = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <UpdateReadyPrompt
        state={readyState}
        isApplying={false}
        isChecking={false}
        onApply={onApply}
        onCheckNow={onCheckNow}
      />,
    );

    expect(await screen.findByText(TITLE_RE)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => {
      expect(screen.queryByText(TITLE_RE)).not.toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /update ready/i })).toBeInTheDocument();

    rerender(
      <UpdateReadyPrompt
        state={readyState}
        isApplying={false}
        isChecking={false}
        onApply={onApply}
        onCheckNow={onCheckNow}
      />,
    );
    expect(screen.queryByText(TITLE_RE)).not.toBeInTheDocument();

    rerender(
      <UpdateReadyPrompt
        state={{ ...readyState, availableVersion: '0.0.24' }}
        isApplying={false}
        isChecking={false}
        onApply={onApply}
        onCheckNow={onCheckNow}
      />,
    );

    expect(await screen.findByText(TITLE_RE)).toBeInTheDocument();
  });

  it('keeps the dialog open when apply is blocked', async () => {
    const onApply = vi.fn().mockResolvedValue(false);
    const onCheckNow = vi.fn().mockResolvedValue(undefined);

    render(
      <UpdateReadyPrompt
        state={readyState}
        isApplying={false}
        isChecking={false}
        onApply={onApply}
        onCheckNow={onCheckNow}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /restart & install/i }));

    expect(onApply).toHaveBeenCalledOnce();
    expect(screen.getByText(TITLE_RE)).toBeInTheDocument();
  });

  it('shows a passive downloaded state while the app is busy', () => {
    render(
      <UpdateReadyPrompt
        state={{ ...readyState, status: 'downloaded' }}
        isApplying={false}
        isChecking={false}
        onApply={vi.fn()}
        onCheckNow={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /update downloaded/i })).toBeDisabled();
    expect(screen.queryByText(TITLE_RE)).not.toBeInTheDocument();
  });

  it('links to the download page when a newer version must be installed by hand', async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('screenforge', { openExternalUrl });

    render(
      <UpdateReadyPrompt
        state={{ currentVersion: '0.0.22', status: 'available', availableVersion: '0.0.23' }}
        isApplying={false}
        isChecking={false}
        onApply={vi.fn()}
        onCheckNow={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /update available/i }));

    expect(openExternalUrl).toHaveBeenCalledWith('https://screenforge.co/download/linux');
    expect(screen.queryByText(TITLE_RE)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('offers an actionable retry when the updater is in error', async () => {
    const onCheckNow = vi.fn().mockResolvedValue(undefined);

    render(
      <UpdateReadyPrompt
        state={{ currentVersion: '0.0.22', status: 'error', errorMessage: 'feed unavailable' }}
        isApplying={false}
        isChecking={false}
        onApply={vi.fn()}
        onCheckNow={onCheckNow}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /retry update/i }));

    expect(onCheckNow).toHaveBeenCalledOnce();
  });
});
