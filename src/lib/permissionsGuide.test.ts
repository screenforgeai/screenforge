import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingPermissionsState } from '../types';
import {
  createPermissionPoller,
  getMissingGuidedPermissions,
  getPermissionCardStatus,
  PERMISSION_POLL_INTERVAL_MS,
  shouldShowPermissionsGuideOnLaunch,
} from './permissionsGuide';

const macState = (
  screen: RecordingPermissionsState['screen'],
  accessibility: RecordingPermissionsState['accessibility'],
): RecordingPermissionsState => ({ required: true, screen, accessibility });

describe('getMissingGuidedPermissions', () => {
  it('lists Screen Recording and Accessibility when neither is granted', () => {
    expect(getMissingGuidedPermissions(macState('not-determined', 'denied'))).toEqual([
      'screen',
      'accessibility',
    ]);
  });

  it('lists only what is still missing', () => {
    expect(getMissingGuidedPermissions(macState('granted', 'not-determined'))).toEqual([
      'accessibility',
    ]);
    expect(getMissingGuidedPermissions(macState('granted', 'granted'))).toEqual([]);
  });

  it('never reports anything missing where the OS has no such permissions', () => {
    expect(
      getMissingGuidedPermissions({ required: false, screen: 'unknown', accessibility: 'unknown' }),
    ).toEqual([]);
  });
});

describe('shouldShowPermissionsGuideOnLaunch', () => {
  it('shows the guide on macOS while a permission is missing', () => {
    expect(shouldShowPermissionsGuideOnLaunch(macState('denied', 'granted'), false)).toBe(true);
  });

  it('stays hidden once everything is granted', () => {
    expect(shouldShowPermissionsGuideOnLaunch(macState('granted', 'granted'), false)).toBe(false);
  });

  it('stays hidden at launch after the user skipped it', () => {
    expect(shouldShowPermissionsGuideOnLaunch(macState('denied', 'denied'), true)).toBe(false);
  });

  it('never blocks Windows or Linux', () => {
    expect(
      shouldShowPermissionsGuideOnLaunch(
        { required: false, screen: 'unknown', accessibility: 'granted' },
        false,
      ),
    ).toBe(false);
  });
});

describe('getPermissionCardStatus', () => {
  it('is granted as soon as the OS reports it', () => {
    expect(getPermissionCardStatus('granted', false)).toBe('granted');
    expect(getPermissionCardStatus('granted', true)).toBe('granted');
  });

  it('asks the user to act until System Settings has been opened', () => {
    expect(getPermissionCardStatus('not-determined', false)).toBe('missing');
    expect(getPermissionCardStatus('denied', false)).toBe('missing');
  });

  it('waits for the change after System Settings has been opened', () => {
    expect(getPermissionCardStatus('denied', true)).toBe('waiting');
    expect(getPermissionCardStatus('unknown', true)).toBe('waiting');
  });
});

describe('createPermissionPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads right away and then on every interval', async () => {
    const read = vi
      .fn<[], Promise<RecordingPermissionsState>>()
      .mockResolvedValueOnce(macState('denied', 'denied'))
      .mockResolvedValueOnce(macState('denied', 'granted'))
      .mockResolvedValue(macState('granted', 'granted'));
    const onUpdate = vi.fn();

    const poller = createPermissionPoller(read, onUpdate);
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdate).toHaveBeenLastCalledWith(macState('denied', 'denied'));

    await vi.advanceTimersByTimeAsync(PERMISSION_POLL_INTERVAL_MS);
    expect(onUpdate).toHaveBeenLastCalledWith(macState('denied', 'granted'));

    await vi.advanceTimersByTimeAsync(PERMISSION_POLL_INTERVAL_MS);
    expect(onUpdate).toHaveBeenLastCalledWith(macState('granted', 'granted'));
    poller.stop();
  });

  it('never runs two reads at once', async () => {
    let resolveRead: (state: RecordingPermissionsState) => void = () => undefined;
    const read = vi.fn(
      () =>
        new Promise<RecordingPermissionsState>((resolve) => {
          resolveRead = resolve;
        }),
    );

    const poller = createPermissionPoller(read, vi.fn());
    await vi.advanceTimersByTimeAsync(PERMISSION_POLL_INTERVAL_MS * 3);
    void poller.refresh();
    expect(read).toHaveBeenCalledTimes(1);

    resolveRead(macState('granted', 'granted'));
    await vi.advanceTimersByTimeAsync(PERMISSION_POLL_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('refreshes immediately on demand, e.g. when the window regains focus', async () => {
    const read = vi.fn().mockResolvedValue(macState('denied', 'denied'));
    const onUpdate = vi.fn();
    const poller = createPermissionPoller(read, onUpdate);
    await vi.advanceTimersByTimeAsync(0);

    read.mockResolvedValue(macState('granted', 'denied'));
    await poller.refresh();

    expect(onUpdate).toHaveBeenLastCalledWith(macState('granted', 'denied'));
    poller.stop();
  });

  it('keeps polling after a failed read and stops cleanly', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('helper timed out'))
      .mockResolvedValue(macState('granted', 'granted'));
    const onUpdate = vi.fn();

    const poller = createPermissionPoller(read, onUpdate);
    await vi.advanceTimersByTimeAsync(PERMISSION_POLL_INTERVAL_MS);
    expect(onUpdate).toHaveBeenCalledWith(macState('granted', 'granted'));

    poller.stop();
    const callsAtStop = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(PERMISSION_POLL_INTERVAL_MS * 4);
    expect(read).toHaveBeenCalledTimes(callsAtStop);
  });

  it('drops a result that arrives after stop', async () => {
    let resolveRead: (state: RecordingPermissionsState) => void = () => undefined;
    const read = vi.fn(
      () =>
        new Promise<RecordingPermissionsState>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const onUpdate = vi.fn();

    const poller = createPermissionPoller(read, onUpdate);
    poller.stop();
    resolveRead(macState('granted', 'granted'));
    await vi.advanceTimersByTimeAsync(0);

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
