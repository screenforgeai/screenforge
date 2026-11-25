import { describe, expect, it } from 'vitest';
import {
  canDismissOnboarding,
  getInitials,
  getNextStep,
  getOnboardingSteps,
  getOnboardingWindowHeight,
  getPreviousStep,
  getScreenPermissionView,
  isValidEmail,
} from './flow';

describe('onboarding steps', () => {
  it('asks for permissions on macOS only', () => {
    expect(getOnboardingSteps('darwin')).toEqual([
      'welcome',
      'about',
      'permissions',
      'preferences',
      'first-recording',
    ]);
    expect(getOnboardingSteps('win32')).toEqual([
      'welcome',
      'about',
      'preferences',
      'first-recording',
    ]);
    expect(getOnboardingSteps('linux')).not.toContain('permissions');
  });

  it('moves forward and back within the steps', () => {
    const steps = getOnboardingSteps('win32');
    expect(getNextStep(steps, 'about')).toBe('preferences');
    expect(getNextStep(steps, 'first-recording')).toBe('first-recording');
    expect(getPreviousStep(steps, 'preferences')).toBe('about');
    expect(getPreviousStep(steps, 'welcome')).toBe('welcome');
  });

  it('cannot be dismissed while screen recording is being set up', () => {
    expect(canDismissOnboarding('permissions')).toBe(false);
    expect(canDismissOnboarding('about')).toBe(true);
  });
});

describe('profile helpers', () => {
  it('accepts the same emails as Settings', () => {
    expect(isValidEmail('sam@example.com')).toBe(true);
    expect(isValidEmail('  sam@example.com ')).toBe(true);
    expect(isValidEmail('sam@example')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('makes initials for the profile preview', () => {
    expect(getInitials('Sam Rivera')).toBe('SR');
    expect(getInitials('  ada  ')).toBe('A');
    expect(getInitials('Mary Ann Lee')).toBe('MA');
    expect(getInitials('')).toBe('');
  });
});

describe('getScreenPermissionView', () => {
  it('offers Allow before anything happened', () => {
    expect(getScreenPermissionView({ status: 'not-determined', requested: false })).toBe('ask');
  });

  it('needs a quit and reopen once access was requested this run', () => {
    expect(getScreenPermissionView({ status: 'not-determined', requested: true })).toBe('pending');
    // Granted during this run (a reopened run too) still only takes effect after a relaunch.
    expect(getScreenPermissionView({ status: 'granted', requested: true })).toBe('pending');
  });

  it('is granted when it was already on when this run started', () => {
    expect(getScreenPermissionView({ status: 'granted', requested: false })).toBe('granted');
  });

  it('points to System Settings when access was turned off', () => {
    expect(getScreenPermissionView({ status: 'denied', requested: false })).toBe('denied');
    expect(getScreenPermissionView({ status: 'restricted', requested: false })).toBe('denied');
  });
});

describe('getOnboardingWindowHeight', () => {
  it('fits the content: picture, 32px to the button, 40px under it', () => {
    // 372 (picture, dots, 24px) + 80 content + 32 + 44 button + 40 inset
    expect(getOnboardingWindowHeight({ contentHeight: 80, hasSecondaryAction: false })).toBe(568);
  });

  it('makes room for the text button and keeps its text 40px from the edge', () => {
    // + 8 gap + 28 text button, and a 36px inset because that button has 4px of air
    expect(getOnboardingWindowHeight({ contentHeight: 80, hasSecondaryAction: true })).toBe(600);
  });
});
