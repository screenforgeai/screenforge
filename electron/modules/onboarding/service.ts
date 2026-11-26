import { decideOnboarding } from '../../../src/lib/onboarding/decision';
import type { OnboardingResumeStep } from '../../../src/lib/onboarding/decision';
import { getSettings, saveSettings } from '../settings/service';
import { wasExistingInstallAtLaunch } from '../whats-new/service';

export type OnboardingLaunch = {
  show: boolean;
  resumeStep: OnboardingResumeStep | null;
};

/** Decides whether this launch opens onboarding; existing users are marked done so it never shows. */
export async function getOnboardingLaunch(): Promise<OnboardingLaunch> {
  const settings = await getSettings();
  const decision = decideOnboarding({
    record: settings.onboarding,
    isExistingInstall: wasExistingInstallAtLaunch(),
  });
  if (decision.markCompleted) {
    await saveSettings({ onboarding: { completed: true } });
  }
  return { show: decision.show, resumeStep: decision.resumeStep };
}

/** Saved right before the quit and reopen, so the next launch comes back to this step. */
export async function setOnboardingResumeStep(step: OnboardingResumeStep): Promise<void> {
  await saveSettings({ onboarding: { completed: false, resumeStep: step } });
}

export async function completeOnboarding(): Promise<void> {
  await saveSettings({ onboarding: { completed: true } });
}
