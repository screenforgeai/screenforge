import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';

const flags = vi.hoisted(() => ({ value: { directorSharing: false } }));
vi.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => flags.value }));
vi.mock('./DirectorAccountPanel', () => ({
  DirectorAccountPanel: () => <div data-testid="account-panel" />,
}));

beforeEach(() => {
  Object.defineProperty(window, 'screenforge', {
    value: {
      getSettings: vi.fn().mockResolvedValue({
        profile: { name: '', email: '' },
        language: 'en',
        telemetryEnabled: true,
      }),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      trackEvent: vi.fn(),
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  flags.value = { directorSharing: false };
});

describe('SettingsModal', () => {
  it('has no Account tab while the director-sharing flag is off', async () => {
    render(<SettingsModal open section="director" onClose={vi.fn()} />);
    expect(await screen.findByRole('tab', { name: /profile/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /account/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('account-panel')).not.toBeInTheDocument();
    // Asked for the hidden section, it opens on Profile instead.
    expect(screen.getByRole('tab', { name: /profile/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('has the Account tab when the flag is on', async () => {
    flags.value = { directorSharing: true };
    render(<SettingsModal open section="director" onClose={vi.fn()} />);
    expect(await screen.findByRole('tab', { name: /account/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
