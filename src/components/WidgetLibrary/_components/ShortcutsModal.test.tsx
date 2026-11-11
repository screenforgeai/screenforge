import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RegisteredCaptureShortcuts } from 'src/types';
import { ShortcutsModal } from './ShortcutsModal';

const renderWithShortcuts = (live: RegisteredCaptureShortcuts) => {
  Object.defineProperty(window, 'screenforge', {
    value: { getCaptureShortcuts: vi.fn().mockResolvedValue(live) },
    configurable: true,
    writable: true,
  });
  render(<ShortcutsModal open onClose={() => undefined} />);
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
    renderWithShortcuts({});
    expect(await screen.findByText('Play / Pause')).toBeInTheDocument();
    expect(screen.queryByText('Capture (from any app)')).not.toBeInTheDocument();
  });
});
