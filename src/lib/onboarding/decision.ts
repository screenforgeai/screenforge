/** The only step onboarding resumes at: after the quit and reopen screen recording needs. */
export type OnboardingResumeStep = 'permissions';

/** What settings.json remembers about first-run onboarding. */
export type OnboardingRecord = {
  completed: boolean;
  resumeStep?: OnboardingResumeStep;
};

export type OnboardingDecisionInput = {
  record: OnboardingRecord | undefined;
  /** Whether Screenforge had run on this machine before this launch. */
  isExistingInstall: boolean;
};

export type OnboardingDecision = {
  show: boolean;
  resumeStep: OnboardingResumeStep | null;
  /** Record onboarding as done without showing it (people who used the app before it existed). */
  markCompleted: boolean;
};

export const decideOnboarding = ({
  record,
  isExistingInstall,
}: OnboardingDecisionInput): OnboardingDecision => {
  if (record?.completed) {
    return { show: false, resumeStep: null, markCompleted: false };
  }
  // Checked before the install state: the relaunch itself makes this look like an existing install.
  if (record?.resumeStep) {
    return { show: true, resumeStep: record.resumeStep, markCompleted: false };
  }
  if (isExistingInstall) {
    return { show: false, resumeStep: null, markCompleted: true };
  }
  return { show: true, resumeStep: null, markCompleted: false };
};
