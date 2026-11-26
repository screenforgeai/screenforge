import { describe, expect, it } from 'vitest';
import { decideOnboarding } from './decision';

describe('decideOnboarding', () => {
  it('shows from the start on a fresh install', () => {
    expect(decideOnboarding({ record: undefined, isExistingInstall: false })).toEqual({
      show: true,
      resumeStep: null,
      markCompleted: false,
    });
  });

  it('never shows to someone who used Screenforge before onboarding existed', () => {
    expect(decideOnboarding({ record: undefined, isExistingInstall: true })).toEqual({
      show: false,
      resumeStep: null,
      markCompleted: true,
    });
  });

  it('does not show again once finished', () => {
    expect(
      decideOnboarding({ record: { completed: true }, isExistingInstall: false }),
    ).toMatchObject({ show: false, markCompleted: false });
  });

  it('resumes at the permissions step after the quit and reopen', () => {
    // The relaunch writes settings.json, so the app now looks like an existing install.
    expect(
      decideOnboarding({
        record: { completed: false, resumeStep: 'permissions' },
        isExistingInstall: true,
      }),
    ).toEqual({ show: true, resumeStep: 'permissions', markCompleted: false });
  });
});
