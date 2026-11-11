import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredCaptureShortcuts } from 'src/types';
import { ShortcutsModal } from './ShortcutsModal';

const renderWithShortcuts = (live: RegisteredCaptureShortcuts) => {
  const getCaptureShortcuts = vi.fn().mockResolvedValue(live);
  Object.defineProperty(window, 'screenforge', {
    value: { getCaptureShortcuts },
    configurable: true,
    writable: true,
  });
  render(<ShortcutsModal open onClose={() => undefined} />);
  return getCaptureShortcuts;
};

afterEach(cleanup);

describe('ShortcutsModal', () => {
  it('lists the capture shortcuts that are working', async () => {
    renderWithShortcuts({ screenshot: 'Alt+Shift+S', record: 'Alt+Shift+R' });
    expect(await screen.findByText('Take Screenshot')).toBeInTheDocument();
    expect(screen.getByText('Open Recording Toolbar')).toBeInTheDocument();
  });

  it('leaves out a capture shortcut another app holds', async () => {
    renderWithShortcuts({ screenshot: 'Alt+Shift+S' });
    expect(await screen.findByText('Take Screenshot')).toBeInTheDocument();
    expect(screen.queryByText('Open Recording Toolbar')).not.toBeInTheDocument();
  });

  it('drops the capture group when no capture shortcut works', async () => {
    const getCaptureShortcuts = renderWithShortcuts({});
    // The group is also absent before the request answers, so wait for it.
    await waitFor(() => expect(getCaptureShortcuts).toHaveBeenCalledOnce());
    await act(async () => {
      await getCaptureShortcuts.mock.results[0]?.value;
    });
    expect(screen.getByText('Play / Pause')).toBeInTheDocument();
    expect(screen.queryByText('Capture (from any app)')).not.toBeInTheDocument();
  });
});
