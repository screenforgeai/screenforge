import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingPermissionsState } from '../../types';
import { PERMISSION_POLL_INTERVAL_MS } from '../../lib/permissionsGuide';
import { PermissionsGuide } from './PermissionsGuide';

const macState = (
  screenStatus: RecordingPermissionsState['screen'],
  accessibility: RecordingPermissionsState['accessibility'],
): RecordingPermissionsState => ({ required: true, screen: screenStatus, accessibility });

function installScreenforge(read: () => Promise<RecordingPermissionsState>) {
  const api = {
    getRecordingPermissions: vi.fn(read),
    openPermissionSettings: vi.fn().mockResolvedValue(undefined),
    relaunchApp: vi.fn(),
    trackEvent: vi.fn(),
  };
  Object.defineProperty(window, 'screenforge', {
    value: api,
    writable: true,
    configurable: true,
  });
  return api;
}

const getCard = (name: string) => screen.getByRole('group', { name });

describe('PermissionsGuide', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('explains both permissions and what each one is for', async () => {
    installScreenforge(() => Promise.resolve(macState('not-determined', 'not-determined')));

    render(<PermissionsGuide open onClose={vi.fn()} />);

    const screenCard = await screen.findByRole('group', { name: 'Screen Recording' });
    expect(screenCard).toHaveTextContent(/capture/i);
    expect(getCard('Accessibility')).toHaveTextContent(/cursor/i);
    expect(screen.getAllByRole('button', { name: 'Open System Settings' })).toHaveLength(2);
  });

  it('opens the right System Settings pane for each permission', async () => {
    const api = installScreenforge(() => Promise.resolve(macState('denied', 'denied')));
    render(<PermissionsGuide open onClose={vi.fn()} />);
    await screen.findByRole('group', { name: 'Screen Recording' });

    const [screenButton, accessibilityButton] = screen.getAllByRole('button', {
      name: 'Open System Settings',
    });
    fireEvent.click(screenButton);
    fireEvent.click(accessibilityButton);

    expect(api.openPermissionSettings).toHaveBeenNthCalledWith(1, 'screen');
    expect(api.openPermissionSettings).toHaveBeenNthCalledWith(2, 'accessibility');
  });

  it('notices a grant while open, without a restart', async () => {
    let state = macState('denied', 'denied');
    installScreenforge(() => Promise.resolve(state));
    render(<PermissionsGuide open onClose={vi.fn()} />);
    await screen.findByRole('group', { name: 'Screen Recording' });
    expect(getCard('Accessibility')).not.toHaveTextContent('Allowed');

    state = macState('denied', 'granted');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PERMISSION_POLL_INTERVAL_MS + 10);
    });

    await waitFor(() => expect(getCard('Accessibility')).toHaveTextContent('Allowed'));
    expect(getCard('Screen Recording')).not.toHaveTextContent('Allowed');
  });

  it('re-checks as soon as the window regains focus', async () => {
    let state = macState('denied', 'granted');
    const api = installScreenforge(() => Promise.resolve(state));
    render(<PermissionsGuide open onClose={vi.fn()} />);
    await screen.findByRole('group', { name: 'Screen Recording' });
    const readsBeforeFocus = api.getRecordingPermissions.mock.calls.length;

    state = macState('granted', 'granted');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(getCard('Screen Recording')).toHaveTextContent('Allowed'));
    expect(api.getRecordingPermissions.mock.calls.length).toBeGreaterThan(readsBeforeFocus);
  });

  it('offers Quit & Reopen once the user went to System Settings and macOS has not caught up', async () => {
    const api = installScreenforge(() => Promise.resolve(macState('denied', 'granted')));
    render(<PermissionsGuide open onClose={vi.fn()} />);
    await screen.findByRole('group', { name: 'Screen Recording' });
    expect(screen.queryByRole('button', { name: 'Quit & Reopen' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Quit & Reopen' }));
    expect(api.relaunchApp).toHaveBeenCalledOnce();
  });

  it('lets the user skip while something is still missing', async () => {
    installScreenforge(() => Promise.resolve(macState('denied', 'granted')));
    const onClose = vi.fn();
    render(<PermissionsGuide open onClose={onClose} />);
    await screen.findByRole('group', { name: 'Screen Recording' });

    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(onClose).toHaveBeenCalledWith('skipped');
  });

  it('finishes with Done once everything is allowed', async () => {
    installScreenforge(() => Promise.resolve(macState('granted', 'granted')));
    const onClose = vi.fn();
    render(<PermissionsGuide open onClose={onClose} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));

    expect(onClose).toHaveBeenCalledWith('done');
    expect(screen.queryByRole('button', { name: 'Skip for now' })).not.toBeInTheDocument();
  });

  it('offers the sample project as a way to try the editor first', async () => {
    installScreenforge(() => Promise.resolve(macState('denied', 'denied')));
    const onOpenSample = vi.fn();
    render(<PermissionsGuide open onClose={vi.fn()} onOpenSample={onOpenSample} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try the sample project' }));

    expect(onOpenSample).toHaveBeenCalledOnce();
  });

  it('stops polling when closed', async () => {
    const api = installScreenforge(() => Promise.resolve(macState('denied', 'denied')));
    const { rerender } = render(<PermissionsGuide open onClose={vi.fn()} />);
    await screen.findByRole('group', { name: 'Screen Recording' });

    rerender(<PermissionsGuide open={false} onClose={vi.fn()} />);
    const readsAtClose = api.getRecordingPermissions.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PERMISSION_POLL_INTERVAL_MS * 4);
    });

    expect(api.getRecordingPermissions).toHaveBeenCalledTimes(readsAtClose);
  });
});
