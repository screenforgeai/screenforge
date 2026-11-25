import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorAccountState, StartupPermissionMap } from 'src/types';
import { OnboardingWindow } from './OnboardingWindow';

type Platform = 'darwin' | 'win32' | 'linux';

const makeApi = ({
  platform = 'win32' as Platform,
  resumeStep = null as 'permissions' | null,
  account = { status: 'signed-out' } as DirectorAccountState,
  permissions = {
    screen: 'not-determined',
    microphone: 'granted',
    camera: 'granted',
    accessibility: 'not-determined',
  } as StartupPermissionMap,
  ffmpegAvailable = true,
  productUpdates = undefined as boolean | undefined,
  resumeSaveFails = false,
  saveFails = false,
  telemetryEnabled = true,
  settingsFailures = 0,
} = {}) => ({
  getOnboardingState: vi.fn().mockResolvedValue({ platform, resumeStep }),
  getSettings: (() => {
    const read = vi.fn();
    for (let i = 0; i < settingsFailures; i += 1) {
      read.mockRejectedValueOnce(new Error('busy'));
    }
    return read.mockResolvedValue({
      profile: { name: '', email: '' },
      language: 'en',
      telemetryEnabled,
      productUpdates,
    });
  })(),
  saveSettings: saveFails
    ? vi.fn().mockRejectedValue(new Error('disk full'))
    : vi.fn().mockResolvedValue({}),
  getDirectorAccount: vi.fn().mockResolvedValue(account),
  identifyUser: vi.fn(),
  trackEvent: vi.fn(),
  getStartupPermissionStatuses: vi.fn().mockResolvedValue(permissions),
  requestOnboardingPermission: vi.fn().mockResolvedValue('not-determined'),
  openSystemSettings: vi.fn(),
  // Fails the first time only, so a retry can succeed.
  setOnboardingResumeStep: resumeSaveFails
    ? vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    : vi.fn().mockResolvedValue(undefined),
  relaunchApp: vi.fn(),
  checkFFmpegStatus: vi.fn().mockResolvedValue({ available: ffmpegAvailable }),
  installFFmpeg: vi.fn(),
  onInstallProgress: vi.fn(() => () => undefined),
  onInstallDone: vi.fn(() => () => undefined),
  finishOnboarding: vi.fn(),
  resizeOnboardingWindow: vi.fn(),
  openExternalUrl: vi.fn(),
  writeDiagnosticLog: vi.fn(),
  captureException: vi.fn(),
});

let api: ReturnType<typeof makeApi>;

const mount = (options?: Parameters<typeof makeApi>[0]) => {
  api = makeApi(options);
  Object.defineProperty(window, 'screenforge', { value: api, configurable: true, writable: true });
  return render(<OnboardingWindow />);
};

const primary = () => screen.getByTestId('onboarding-primary');

describe('OnboardingWindow', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
  });

  it('walks a Windows user from welcome to their first recording', async () => {
    const user = userEvent.setup();
    mount({ platform: 'win32' });

    expect(
      await screen.findByRole('heading', { name: 'Welcome to Screenforge' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    await user.click(primary());

    expect(await screen.findByRole('heading', { name: 'Stay in touch' })).toBeInTheDocument();
    expect(primary()).toBeDisabled();
    await user.type(screen.getByLabelText('Name'), 'Sam Rivera');
    await user.type(screen.getByLabelText('Email address'), 'sam@example.com');
    await user.click(screen.getByLabelText('Email me product updates and tips'));
    await user.click(primary());

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({
        profile: { name: 'Sam Rivera', email: 'sam@example.com' },
        productUpdates: true,
      }),
    );
    // After the short saving spinner.
    await waitFor(() =>
      expect(api.identifyUser).toHaveBeenCalledWith({
        name: 'Sam Rivera',
        email: 'sam@example.com',
      }),
    );

    // No permissions step outside macOS.
    expect(await screen.findByRole('heading', { name: 'Make it yours' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Share usage data' }));
    await user.click(primary());
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({ language: 'en', telemetryEnabled: false }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Record your first video' }),
    ).toBeInTheDocument();
    // Record waits until FFmpeg is confirmed.
    await waitFor(() => expect(primary()).toBeEnabled());
    await user.click(primary());
    expect(api.finishOnboarding).toHaveBeenCalledWith('record');
  });

  it('keeps the product updates choice saved before the quit and reopen', async () => {
    const user = userEvent.setup();
    mount({
      platform: 'darwin',
      resumeStep: 'permissions',
      productUpdates: true,
      permissions: {
        screen: 'granted',
        microphone: 'granted',
        camera: 'granted',
        accessibility: 'granted',
      },
    });
    await screen.findByRole('heading', { name: 'Welcome back' });
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByLabelText('Email me product updates and tips')).toBeChecked();
  });

  it('shows the email error only after leaving the field, and Skip saves nothing', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId('onboarding-primary'));
    await screen.findByRole('heading', { name: 'Stay in touch' });

    await user.type(screen.getByLabelText('Email address'), 'sam@example');
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('heading', { name: 'Make it yours' })).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it('fills in the email from a Screenforge Director sign-in', async () => {
    const user = userEvent.setup();
    mount({
      account: {
        status: 'signed-in',
        user: { id: 'u1', email: 'sam@acme.test' },
        workspace: { id: 'w1', name: 'Acme' },
        remembered: true,
      },
    });
    await user.click(await screen.findByTestId('onboarding-primary'));

    expect(await screen.findByLabelText('Email address')).toHaveValue('sam@acme.test');
    expect(screen.getByText('From Screenforge Director')).toBeInTheDocument();
    expect(primary()).toBeEnabled();
  });

  it('asks for screen recording on macOS, then quits and reopens at the same step', async () => {
    const user = userEvent.setup();
    mount({ platform: 'darwin' });
    await user.click(await screen.findByTestId('onboarding-primary'));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));

    expect(
      await screen.findByRole('heading', { name: 'Allow screen recording' }),
    ).toBeInTheDocument();
    expect(primary()).toBeDisabled();
    // Screen recording is required, so setup can't be closed here.
    expect(screen.queryByRole('button', { name: 'Skip setup' })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Allow' })[0]);
    expect(api.requestOnboardingPermission).toHaveBeenCalledWith('screen');
    // macOS hasn't reported the grant yet: keep a way to turn it on, and offer the restart.
    expect(await screen.findByRole('button', { name: 'Open Settings' })).toBeInTheDocument();
    expect(
      screen.getByText('Turn on Screenforge in System Settings, then reopen'),
    ).toBeInTheDocument();
    expect(primary()).toHaveTextContent('Quit and reopen');

    await user.click(primary());
    await waitFor(() => expect(api.relaunchApp).toHaveBeenCalled());
    expect(api.setOnboardingResumeStep).toHaveBeenCalledWith('permissions');
  });

  it('stays on the step to retry when the resume step could not be saved', async () => {
    const user = userEvent.setup();
    mount({ platform: 'darwin', resumeSaveFails: true });
    await user.click(await screen.findByTestId('onboarding-primary'));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await user.click((await screen.findAllByRole('button', { name: 'Allow' }))[0]);
    await waitFor(() => expect(primary()).toHaveTextContent('Quit and reopen'));

    await user.click(primary());
    await waitFor(() => expect(api.setOnboardingResumeStep).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(primary()).toBeEnabled());
    expect(api.relaunchApp).not.toHaveBeenCalled();

    await user.click(primary());
    await waitFor(() => expect(api.relaunchApp).toHaveBeenCalledTimes(1));
    expect(api.setOnboardingResumeStep).toHaveBeenCalledTimes(2);
  });

  it('keeps a saved opt-out when the first settings read fails', async () => {
    const user = userEvent.setup();
    mount({ telemetryEnabled: false, settingsFailures: 1 });
    await user.click(await screen.findByTestId('onboarding-primary'));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: 'Make it yours' });

    expect(screen.getByRole('switch', { name: 'Share usage data' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await user.click(primary());
    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith({ language: 'en', telemetryEnabled: false }),
    );
  });

  it('does not save over choices it could not read', async () => {
    const user = userEvent.setup();
    mount({ settingsFailures: 2 });
    await user.click(await screen.findByTestId('onboarding-primary'));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: 'Make it yours' });

    await user.click(primary());
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ language: 'en' }));
  });

  it('stays on Preferences when they could not be saved', async () => {
    const user = userEvent.setup();
    mount({ saveFails: true });
    await user.click(await screen.findByTestId('onboarding-primary'));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: 'Make it yours' });

    await user.click(primary());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't save your preferences. Try again.",
    );
    expect(screen.getByRole('heading', { name: 'Make it yours' })).toBeInTheDocument();
    expect(primary()).toBeEnabled();
  });

  it('welcomes the user back after the relaunch', async () => {
    mount({
      platform: 'darwin',
      resumeStep: 'permissions',
      permissions: {
        screen: 'granted',
        microphone: 'granted',
        camera: 'granted',
        accessibility: 'granted',
      },
    });

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    await waitFor(() => expect(primary()).toBeEnabled());
    expect(screen.getAllByText('Granted')).toHaveLength(2);
  });

  it('closes setup into the editor from the close button', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Skip setup' }));
    expect(api.finishOnboarding).toHaveBeenCalledWith('editor');
  });

  it('installs FFmpeg on the last step when it is missing', async () => {
    const user = userEvent.setup();
    mount({ ffmpegAvailable: false });
    await user.click(await screen.findByTestId('onboarding-primary'));
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { name: 'Make it yours' });
    await user.click(primary());

    expect(await screen.findByText('Installing FFmpeg')).toBeInTheDocument();
    expect(api.installFFmpeg).toHaveBeenCalled();
    expect(primary()).toBeDisabled();
  });
});
