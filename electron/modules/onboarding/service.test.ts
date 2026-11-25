// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  app: { getPath: vi.fn<[string], string>(), getVersion: vi.fn<[], string>() },
}));
const installState = vi.hoisted(() => ({ existing: false }));

vi.mock('electron', () => ({ app: electronMock.app }));
vi.mock('../../lib/telemetry', () => ({ setTelemetryEnabled: vi.fn() }));
vi.mock('../features/service', () => ({ refreshFeatureFlags: vi.fn() }));
vi.mock('../whats-new/service', () => ({
  wasExistingInstallAtLaunch: () => installState.existing,
}));

import { completeOnboarding, getOnboardingLaunch, setOnboardingResumeStep } from './service';

const readSettingsFile = (userData: string) =>
  JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;

describe('onboarding service', () => {
  let userData: string;

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'screenforge-onboarding-'));
    electronMock.app.getPath.mockReturnValue(userData);
    installState.existing = false;
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it('opens onboarding from the start on a fresh install', async () => {
    expect(await getOnboardingLaunch()).toEqual({ show: true, resumeStep: null });
  });

  it('skips onboarding for existing users and remembers that', async () => {
    installState.existing = true;

    expect(await getOnboardingLaunch()).toEqual({ show: false, resumeStep: null });
    expect(readSettingsFile(userData).onboarding).toEqual({ completed: true });
  });

  it('comes back at the permissions step after the quit and reopen', async () => {
    await setOnboardingResumeStep('permissions');
    installState.existing = true;

    expect(await getOnboardingLaunch()).toEqual({ show: true, resumeStep: 'permissions' });
  });

  it('never opens again once completed', async () => {
    await setOnboardingResumeStep('permissions');
    await completeOnboarding();

    expect(readSettingsFile(userData).onboarding).toEqual({ completed: true });
    expect(await getOnboardingLaunch()).toEqual({ show: false, resumeStep: null });
  });
});
