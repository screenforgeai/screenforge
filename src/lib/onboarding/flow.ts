import type { StartupPermissionStatus } from '../../types';

export type OnboardingStep =
  | 'welcome'
  | 'about'
  | 'permissions'
  | 'preferences'
  | 'first-recording';

/** How onboarding ends: straight into a recording, or into the editor. */
export type OnboardingOutcome = 'record' | 'editor';

const ALL_STEPS: OnboardingStep[] = [
  'welcome',
  'about',
  'permissions',
  'preferences',
  'first-recording',
];

/** Only macOS asks for Screen Recording and Accessibility up front. */
export const getOnboardingSteps = (platform: string): OnboardingStep[] =>
  platform === 'darwin' ? ALL_STEPS : ALL_STEPS.filter((step) => step !== 'permissions');

export const getNextStep = (steps: OnboardingStep[], current: OnboardingStep): OnboardingStep =>
  steps[Math.min(steps.length - 1, steps.indexOf(current) + 1)];

export const getPreviousStep = (steps: OnboardingStep[], current: OnboardingStep): OnboardingStep =>
  steps[Math.max(0, steps.indexOf(current) - 1)];

/** Screen recording is required, so setup can't be closed halfway through granting it. */
export const canDismissOnboarding = (step: OnboardingStep): boolean => step !== 'permissions';

// The same rule Settings → Profile uses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (value: string): boolean => EMAIL_PATTERN.test(value.trim());

export const getInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');

export type ScreenPermissionView = 'ask' | 'pending' | 'granted' | 'denied';

/**
 * macOS only applies Screen Recording to a running app after it restarts, so any
 * request made in this run ends in "Quit and reopen".
 */
export const getScreenPermissionView = ({
  status,
  requested,
  relaunched,
}: {
  status: StartupPermissionStatus;
  requested: boolean;
  relaunched: boolean;
}): ScreenPermissionView => {
  if (status === 'granted') {
    return requested && !relaunched ? 'pending' : 'granted';
  }
  if (requested) {
    return 'pending';
  }
  if (status === 'denied' || status === 'restricted') {
    return 'denied';
  }
  return 'ask';
};

// Fixed parts of the window, in px. The picture and dots end at 348; the copy starts 24px below.
export const ONBOARDING_WIDTH = 600;
const CONTENT_TOP = 372;
const CONTENT_TO_BUTTON = 32;
const BUTTON_HEIGHT = 44;
const SECONDARY_GAP = 8;
const SECONDARY_HEIGHT = 28;
// 40px under the last thing at the bottom; the text button has 4px of air inside its box.
const BOTTOM_INSET = 40;
const BOTTOM_INSET_UNDER_TEXT_BUTTON = 36;

export const getOnboardingWindowHeight = ({
  contentHeight,
  hasSecondaryAction,
}: {
  contentHeight: number;
  hasSecondaryAction: boolean;
}): number =>
  CONTENT_TOP +
  contentHeight +
  CONTENT_TO_BUTTON +
  BUTTON_HEIGHT +
  (hasSecondaryAction
    ? SECONDARY_GAP + SECONDARY_HEIGHT + BOTTOM_INSET_UNDER_TEXT_BUTTON
    : BOTTOM_INSET);

export const ONBOARDING_BOTTOM_INSET = BOTTOM_INSET;
export const ONBOARDING_BOTTOM_INSET_UNDER_TEXT_BUTTON = BOTTOM_INSET_UNDER_TEXT_BUTTON;
