import { CH } from '../../channels';
import { handleChannel, listenChannel } from '../../lib/ipc-main';
import type { OnboardingResumeStep } from '../../../src/lib/onboarding/decision';
import type { OnboardingOutcome } from '../../../src/lib/onboarding/flow';
import type {
  OnboardingPermission,
  OnboardingState,
  StartupPermissionStatus,
} from '../../../src/types/index';
import { openSystemSettings, requestAccessibilityAccess } from '../app/service';
import { requestMacScreenCaptureAccess } from '../sources/service';
import { setOnboardingResumeStep } from './service';
import {
  finishOnboardingWindow,
  getOnboardingLaunchResumeStep,
  markOnboardingResumePending,
  resizeOnboardingWindow,
} from './window';

const OUTCOMES = new Set<OnboardingOutcome>(['record', 'editor']);
const RESUME_STEPS = new Set<OnboardingResumeStep>(['permissions']);

// macOS shows its Accessibility prompt only once; after that, Allow opens the right pane instead.
let accessibilityAsked = false;

async function requestPermission(
  permission: OnboardingPermission,
): Promise<StartupPermissionStatus> {
  if (permission === 'screen') {
    // Registers Screenforge in Screen Recording and shows macOS's own prompt.
    return requestMacScreenCaptureAccess();
  }
  const status = await requestAccessibilityAccess();
  if (status !== 'granted' && accessibilityAsked) {
    await openSystemSettings('accessibility');
  }
  accessibilityAsked = true;
  return status;
}

export function registerOnboardingChannels(): void {
  handleChannel<[], OnboardingState>(CH.onboarding.GET_STATE, () => ({
    platform: process.platform,
    resumeStep: getOnboardingLaunchResumeStep(),
  }));

  handleChannel<[OnboardingResumeStep], void>(CH.onboarding.SET_RESUME_STEP, async (step) => {
    if (!RESUME_STEPS.has(step)) {
      return;
    }
    // Marked only once saved: a failed save leaves a later close counting as done.
    await setOnboardingResumeStep(step);
    markOnboardingResumePending();
  });

  handleChannel<[OnboardingPermission], StartupPermissionStatus>(
    CH.onboarding.REQUEST_PERMISSION,
    (permission) =>
      permission === 'screen' || permission === 'accessibility'
        ? requestPermission(permission)
        : 'unknown',
  );

  listenChannel<[number]>(CH.onboarding.RESIZE, (height) => resizeOnboardingWindow(height));

  listenChannel<[OnboardingOutcome]>(CH.onboarding.FINISH, (outcome) => {
    void finishOnboardingWindow(OUTCOMES.has(outcome) ? outcome : 'editor');
  });
}
