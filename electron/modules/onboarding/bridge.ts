import { CH } from '../../channels';
import { createInvokeBridge, createSendBridge } from '../../lib/ipc-renderer';
import type { OnboardingResumeStep } from '../../../src/lib/onboarding/decision';
import type { OnboardingOutcome } from '../../../src/lib/onboarding/flow';
import type {
  OnboardingPermission,
  OnboardingState,
  StartupPermissionStatus,
} from '../../../src/types/index';

export const onboardingBridge = {
  getOnboardingState: createInvokeBridge<[], OnboardingState>(CH.onboarding.GET_STATE),
  setOnboardingResumeStep: createInvokeBridge<[OnboardingResumeStep], void>(
    CH.onboarding.SET_RESUME_STEP,
  ),
  requestOnboardingPermission: createInvokeBridge<[OnboardingPermission], StartupPermissionStatus>(
    CH.onboarding.REQUEST_PERMISSION,
  ),
  resizeOnboardingWindow: createSendBridge<[number]>(CH.onboarding.RESIZE),
  finishOnboarding: createSendBridge<[OnboardingOutcome]>(CH.onboarding.FINISH),
};
