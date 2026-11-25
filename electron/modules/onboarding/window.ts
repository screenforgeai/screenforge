import { BrowserWindow } from 'electron';
import type { OnboardingResumeStep } from '../../../src/lib/onboarding/decision';
import { getOnboardingWindowHeight, ONBOARDING_WIDTH } from '../../../src/lib/onboarding/flow';
import type { OnboardingOutcome } from '../../../src/lib/onboarding/flow';
import log from '../../lib/logger';
import { completeOnboarding } from './service';

type OnboardingWindowDeps = {
  preloadPath: string;
  loadURL: (win: BrowserWindow, hash?: string) => void;
  iconPath?: string;
  resumeStep: OnboardingResumeStep | null;
};

// The welcome step's height, so the first frame is the right size (the window then fits each step).
const FIRST_HEIGHT = getOnboardingWindowHeight({ contentHeight: 80, hasSecondaryAction: false });
const MIN_HEIGHT = 480;
const MAX_HEIGHT = 900;

let onboardingWindow: BrowserWindow | null = null;
let launchResumeStep: OnboardingResumeStep | null = null;
let settleOutcome: ((outcome: OnboardingOutcome) => void) | null = null;
// Set when the window saves a step to resume at: it is about to quit and reopen, not finish.
let resumePending = false;
// The completion write the window started when it finished itself, if any.
let finishing: Promise<void> | null = null;

export function getOnboardingLaunchResumeStep(): OnboardingResumeStep | null {
  return launchResumeStep;
}

export function markOnboardingResumePending(): void {
  resumePending = true;
}

/** Opens the first-run window and resolves with how it ended. */
export function runOnboardingWindow(deps: OnboardingWindowDeps): Promise<OnboardingOutcome> {
  launchResumeStep = deps.resumeStep;
  resumePending = false;
  finishing = null;

  return new Promise<OnboardingOutcome>((resolve) => {
    let settled = false;
    settleOutcome = (outcome) => {
      if (settled) {
        return;
      }
      settled = true;
      settleOutcome = null;
      resolve(outcome);
    };

    const win = new BrowserWindow({
      width: ONBOARDING_WIDTH,
      height: FIRST_HEIGHT,
      useContentSize: true,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: '#0b0b0d',
      title: 'Screenforge',
      icon: deps.iconPath,
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        sandbox: false,
      },
    });
    onboardingWindow = win;

    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    win.on('closed', () => {
      onboardingWindow = null;
      if (resumePending) {
        settleOutcome?.('editor');
        return;
      }
      // Either the window's own completion write, or (closed from the system: ⌘W, Alt+F4)
      // a new one. The editor starts only after it lands, so its own settings writes
      // can't bring the old record back.
      const completion =
        finishing ??
        completeOnboarding().catch((error) =>
          log.warn('[onboarding] could not record completion', error),
        );
      void completion.finally(() => settleOutcome?.('editor'));
    });

    deps.loadURL(win, 'onboarding');
  });
}

/** Fits the window to the current step; macOS animates the change. */
export function resizeOnboardingWindow(height: number): void {
  if (!onboardingWindow || onboardingWindow.isDestroyed() || !Number.isFinite(height)) {
    return;
  }
  const next = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)));
  const [, current] = onboardingWindow.getContentSize();
  if (current === next) {
    return;
  }
  onboardingWindow.setContentSize(ONBOARDING_WIDTH, next, true);
}

export async function finishOnboardingWindow(outcome: OnboardingOutcome): Promise<void> {
  if (finishing) {
    return;
  }
  finishing = completeOnboarding().catch((error) =>
    log.warn('[onboarding] could not record completion', error),
  );
  await finishing;
  log.info('[onboarding] finished', { outcome });
  settleOutcome?.(outcome);
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.close();
  }
}
