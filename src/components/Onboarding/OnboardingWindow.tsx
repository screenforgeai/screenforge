import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { identifyUser, trackEvent } from '../../lib/analytics';
import {
  IconAlertCircle,
  IconAnalytics,
  IconCheck,
  IconChevronLeft,
  IconDeviceDesktop,
  IconDownload,
  IconGlobe,
  IconInfo,
  IconLoading,
  IconPointer,
  IconX,
} from '../../lib/icons';
import { PRIVACY_POLICY_URL } from '../../lib/siteLinks';
import { SUPPORTED_LANGUAGES, detectBrowserLanguage } from '../../lib/userProfile';
import {
  canDismissOnboarding,
  getNextStep,
  getOnboardingSteps,
  getOnboardingWindowHeight,
  getPreviousStep,
  getScreenPermissionView,
  isValidEmail,
} from '../../lib/onboarding/flow';
import type { OnboardingOutcome, OnboardingStep } from '../../lib/onboarding/flow';
import type { DirectorAccountState, StartupPermissionMap } from '../../types';
import { OnboardingHero } from './OnboardingHero';
import { useTravellingDot } from './useTravellingDot';
import './onboarding.css';

type Direction = 'forward' | 'back';
type FfmpegState = 'unknown' | 'ready' | 'installing' | 'failed';
type Leaving = { step: OnboardingStep; direction: Direction; key: number };
type FooterAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  secondary?: { label: string; onClick: () => void };
};

// Saving shows its spinner at least this long, like Settings, so it reads as a step.
const MIN_SAVE_MS = 400;
const LEAVE_MS = 260;
const SIGNED_OUT: DirectorAccountState = { status: 'signed-out' };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toSupportedLanguage = (code: string): string => {
  const base = code.split('-')[0];
  return SUPPORTED_LANGUAGES.some((option) => option.code === base) ? base : 'en';
};

const formatBytes = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** The first-run window (`#onboarding`): its own compact window before the editor opens. */
export const OnboardingWindow = () => {
  const { t } = useTranslation('onboarding');
  const { t: tCommon } = useTranslation('common');
  const api = window.screenforge;

  const [ready, setReady] = useState(false);
  const [still, setStill] = useState(true);
  const [platform, setPlatform] = useState('');
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [direction, setDirection] = useState<Direction>('forward');
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  const leaveKey = useRef(0);

  // About you
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [fromDirector, setFromDirector] = useState(false);
  const [productUpdates, setProductUpdates] = useState(false);
  const [saving, setSaving] = useState(false);

  // Permissions (macOS)
  const [relaunched, setRelaunched] = useState(false);
  const [permissions, setPermissions] = useState<StartupPermissionMap | null>(null);
  const [screenRequested, setScreenRequested] = useState(false);
  const [relaunching, setRelaunching] = useState(false);

  // Preferences
  const systemLanguage = useMemo(() => toSupportedLanguage(detectBrowserLanguage()), []);
  const [language, setLanguage] = useState(() => toSupportedLanguage(i18n.language || 'en'));
  const [usage, setUsage] = useState(true);

  // FFmpeg, on the last step and only when it's missing
  const [ffmpeg, setFfmpeg] = useState<FfmpegState>('unknown');
  const [ffProgress, setFfProgress] = useState({ downloaded: 0, total: 0 });

  const steps = useMemo(() => getOnboardingSteps(platform), [platform]);
  const index = Math.max(0, steps.indexOf(step));
  const dotRef = useTravellingDot(index);

  useEffect(() => {
    document.title = t('windowLabel');
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.getOnboardingState(),
      api.getSettings(),
      api.getDirectorAccount().catch(() => SIGNED_OUT),
    ])
      .then(([state, settings, account]) => {
        if (cancelled) {
          return;
        }
        setPlatform(state.platform);
        if (state.resumeStep) {
          setStep(state.resumeStep);
          setRelaunched(true);
        }
        setName(settings.profile.name);
        if (settings.profile.email) {
          setEmail(settings.profile.email);
        } else if (account.status === 'signed-in') {
          setEmail(account.user.email);
          setFromDirector(true);
        }
        setProductUpdates(settings.productUpdates ?? false);
        setUsage(settings.telemetryEnabled);
        trackEvent('onboarding_step_viewed', {
          step: state.resumeStep ?? 'welcome',
          resumed: Boolean(state.resumeStep),
        });
      })
      .catch((error: unknown) => {
        api.writeDiagnosticLog('onboarding.load-failed', { message: String(error) });
      })
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Nothing animates on the first paint.
  useEffect(() => {
    if (!ready) {
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setStill(false));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [ready]);

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = window.setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const goTo = useCallback(
    (next: OnboardingStep, dir: Direction) => {
      if (next === step) {
        return;
      }
      leaveKey.current += 1;
      setLeaving({ step, direction: dir, key: leaveKey.current });
      setDirection(dir);
      setStep(next);
      trackEvent('onboarding_step_viewed', { step: next });
    },
    [step],
  );

  const goNext = useCallback(() => goTo(getNextStep(steps, step), 'forward'), [goTo, steps, step]);
  const goBack = useCallback(() => goTo(getPreviousStep(steps, step), 'back'), [goTo, steps, step]);

  const finish = useCallback(
    (outcome: OnboardingOutcome) => {
      trackEvent('onboarding_completed', { outcome, step });
      api.finishOnboarding(outcome);
    },
    [api, step],
  );

  // ── About you ──
  const emailInvalid = emailTouched && email.trim() !== '' && !isValidEmail(email);

  const saveProfile = async () => {
    if (!isValidEmail(email)) {
      setEmailTouched(true);
      return;
    }
    const profile = { name: name.trim(), email: email.trim() };
    setSaving(true);
    try {
      await Promise.all([api.saveSettings({ profile, productUpdates }), wait(MIN_SAVE_MS)]);
    } catch (error) {
      // Never blocks the flow; the profile can be set again in Settings.
      api.writeDiagnosticLog('onboarding.profile-save-failed', { message: String(error) });
    }
    identifyUser(profile);
    trackEvent('onboarding_profile_saved', {
      has_name: Boolean(profile.name),
      product_updates: productUpdates,
      from_director: fromDirector,
    });
    setSaving(false);
    goNext();
  };

  const skipProfile = () => {
    trackEvent('onboarding_profile_skipped');
    goNext();
  };

  // ── Permissions ──
  const refreshPermissions = useCallback(async () => {
    try {
      setPermissions(await api.getStartupPermissionStatuses());
    } catch {
      // Keep the last known state.
    }
  }, [api]);

  // Read on arrival and whenever the window comes back to the front (from System Settings).
  useEffect(() => {
    if (step !== 'permissions') {
      return;
    }
    void refreshPermissions();
    const onFocus = () => {
      void refreshPermissions();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [step, refreshPermissions]);

  const screenView = getScreenPermissionView({
    status: permissions?.screen ?? 'not-determined',
    requested: screenRequested,
  });
  const accessibilityGranted = permissions?.accessibility === 'granted';
  const welcomeBack = relaunched && screenView === 'granted';

  const allowScreen = async () => {
    setScreenRequested(true);
    trackEvent('onboarding_permission_requested', { permission: 'screen' });
    try {
      await api.requestOnboardingPermission('screen');
    } finally {
      void refreshPermissions();
    }
  };

  const openScreenSettings = () => {
    setScreenRequested(true);
    api.openSystemSettings('screen');
  };

  const allowAccessibility = async () => {
    trackEvent('onboarding_permission_requested', { permission: 'accessibility' });
    try {
      await api.requestOnboardingPermission('accessibility');
    } finally {
      void refreshPermissions();
    }
  };

  const quitAndReopen = async () => {
    setRelaunching(true);
    trackEvent('onboarding_relaunch_requested');
    try {
      await api.setOnboardingResumeStep('permissions');
    } catch (error) {
      // Without the saved step the reopened app would start over, so stay here and let them retry.
      api.writeDiagnosticLog('onboarding.resume-save-failed', { message: String(error) });
      setRelaunching(false);
      return;
    }
    api.relaunchApp();
  };

  // ── Preferences ──
  const changeLanguage = (code: string) => {
    setLanguage(code);
    void i18n.changeLanguage(code);
  };

  const savePreferences = async () => {
    setSaving(true);
    try {
      await api.saveSettings({ language, telemetryEnabled: usage });
    } catch (error) {
      api.writeDiagnosticLog('onboarding.preferences-save-failed', { message: String(error) });
    }
    trackEvent('onboarding_preferences_saved', { language, telemetry_enabled: usage });
    setSaving(false);
    goNext();
  };

  // ── FFmpeg ──
  const installFfmpeg = useCallback(() => {
    setFfmpeg('installing');
    setFfProgress({ downloaded: 0, total: 0 });
    api.installFFmpeg();
  }, [api]);

  useEffect(() => {
    if (step !== 'first-recording' || ffmpeg !== 'unknown') {
      return;
    }
    let cancelled = false;
    api
      .checkFFmpegStatus()
      .then(({ available }) => {
        if (cancelled) {
          return;
        }
        if (available) {
          setFfmpeg('ready');
        } else {
          installFfmpeg();
        }
      })
      .catch(() => {
        // Can't tell whether it's there: install it rather than open a recorder that may not save.
        if (!cancelled) {
          installFfmpeg();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, step, ffmpeg, installFfmpeg]);

  useEffect(() => {
    if (ffmpeg !== 'installing') {
      return;
    }
    const offProgress = api.onInstallProgress(setFfProgress);
    const offDone = api.onInstallDone(({ success }) => setFfmpeg(success ? 'ready' : 'failed'));
    return () => {
      offProgress();
      offDone();
    };
  }, [api, ffmpeg]);

  // ── Footer ──
  const footer: FooterAction = (() => {
    switch (step) {
      case 'about':
        return {
          label: t('continue'),
          onClick: () => void saveProfile(),
          disabled: !saving && !isValidEmail(email),
          busy: saving,
          secondary: saving ? undefined : { label: t('skipForNow'), onClick: skipProfile },
        };
      case 'permissions':
        return screenView === 'pending'
          ? { label: t('quitAndReopen'), onClick: () => void quitAndReopen(), busy: relaunching }
          : { label: t('continue'), onClick: goNext, disabled: screenView !== 'granted' };
      case 'preferences':
        return { label: t('continue'), onClick: () => void savePreferences(), busy: saving };
      case 'first-recording':
        return {
          label: t('record_cta'),
          onClick: () => finish('record'),
          // Only once FFmpeg is confirmed: the toolbar opens straight away.
          disabled: ffmpeg !== 'ready',
          secondary: { label: t('exploreEditor'), onClick: () => finish('editor') },
        };
      default:
        return { label: t('welcome_cta'), onClick: goNext };
    }
  })();

  // Enter presses the main button; Esc goes back a step.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key === 'Escape') {
        if (index > 0 && !saving && !relaunching) {
          event.preventDefault();
          goBack();
        }
        return;
      }
      if (event.key !== 'Enter' || target?.closest('button, select, a, input[type="checkbox"]')) {
        return;
      }
      if (target?.id === 'ob-email') {
        setEmailTouched(true);
      }
      if (!footer.disabled && !footer.busy) {
        event.preventDefault();
        footer.onClick();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // ── Fit the window to the step ──
  const panesRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  const lastHeight = useRef(0);
  // Re-measure once the web font has loaded: it changes how the copy wraps.
  const [, setFontsReady] = useState(false);

  useEffect(() => {
    void document.fonts?.ready.then(() => setFontsReady(true));
  }, []);

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!ready || !pane) {
      return;
    }
    let contentHeight = 0;
    for (const child of Array.from(pane.children) as HTMLElement[]) {
      if (child.offsetParent !== null) {
        contentHeight = Math.max(contentHeight, child.offsetTop + child.offsetHeight);
      }
    }
    if (panesRef.current) {
      panesRef.current.style.height = `${contentHeight}px`;
    }
    const height = getOnboardingWindowHeight({
      contentHeight,
      hasSecondaryAction: Boolean(footer.secondary),
    });
    if (height !== lastHeight.current) {
      lastHeight.current = height;
      api.resizeOnboardingWindow(height);
    }
  });

  // ── Step content ──
  const renderStep = (target: OnboardingStep, active: boolean): ReactNode => {
    const id = (value: string) => (active ? value : undefined);
    switch (target) {
      case 'about': {
        const hint = emailInvalid ? 'error' : fromDirector ? 'director' : null;
        return (
          <>
            <div className="ob-copy">
              <h1 className="ob-title">{t('about_title')}</h1>
              <p className="ob-desc">
                {t('about_desc')}{' '}
                <button
                  type="button"
                  className="ob-link"
                  onClick={() => api.openExternalUrl(PRIVACY_POLICY_URL)}
                >
                  {t('privacyPolicy')}
                </button>
              </p>
            </div>
            <div className="ob-fields">
              <div className="ob-pair">
                <input
                  id={id('ob-name')}
                  className="ob-input"
                  type="text"
                  autoComplete="name"
                  aria-label={t('name_label')}
                  placeholder={t('name_placeholder')}
                  value={name}
                  disabled={saving}
                  onChange={(event) => setName(event.target.value)}
                />
                <input
                  id={id('ob-email')}
                  className="ob-input"
                  type="email"
                  autoComplete="email"
                  aria-label={t('email_label')}
                  aria-invalid={emailInvalid}
                  aria-describedby={hint && active ? 'ob-email-hint' : undefined}
                  placeholder={t('email_placeholder')}
                  value={email}
                  disabled={saving}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setFromDirector(false);
                  }}
                  onFocus={() => setEmailTouched(false)}
                  onBlur={() => setEmailTouched(true)}
                />
              </div>
              {hint && (
                <div className="ob-under">
                  <span
                    id={id('ob-email-hint')}
                    className="ob-under-msg"
                    data-tone={hint === 'error' ? 'error' : undefined}
                    title={hint === 'director' ? tCommon('directorInfo') : undefined}
                  >
                    {hint === 'error' ? <IconAlertCircle size={16} /> : <IconInfo size={16} />}
                    {hint === 'error' ? t('email_invalid') : t('email_fromDirector')}
                  </span>
                </div>
              )}
              <label className="ob-check">
                <input
                  type="checkbox"
                  checked={productUpdates}
                  disabled={saving}
                  onChange={(event) => setProductUpdates(event.target.checked)}
                />
                {t('productUpdates')}
              </label>
            </div>
          </>
        );
      }
      case 'permissions': {
        const granted = (
          <span className="ob-state">
            <IconCheck size={16} />
            {t('granted')}
          </span>
        );
        const screenControl = {
          ask: (
            <button type="button" className="ob-pill" onClick={() => void allowScreen()}>
              {t('allow')}
            </button>
          ),
          pending: <span className="ob-state">{t('needsReopen')}</span>,
          granted,
          denied: (
            <button type="button" className="ob-pill" onClick={openScreenSettings}>
              {t('openSettings')}
            </button>
          ),
        }[screenView];
        return (
          <>
            <div className="ob-copy">
              <h1 className="ob-title">
                {welcomeBack ? t('permissions_backTitle') : t('permissions_title')}
              </h1>
              <p className="ob-desc">
                {welcomeBack
                  ? t('permissions_backDesc')
                  : screenView === 'pending'
                    ? t('permissions_pendingDesc')
                    : t('permissions_desc')}
              </p>
            </div>
            <div className="ob-rows">
              <div className="ob-row">
                <IconDeviceDesktop size={18} />
                <div className="ob-row-text">
                  <span className="ob-row-name">{t('screen_name')}</span>
                  <span className="ob-row-sub">
                    {screenView === 'denied' && <IconAlertCircle size={16} />}
                    {screenView === 'pending'
                      ? t('screen_pendingDesc')
                      : screenView === 'denied'
                        ? t('screen_deniedDesc')
                        : t('screen_desc')}
                  </span>
                </div>
                {screenControl}
              </div>
              <div className="ob-row">
                <IconPointer size={18} />
                <div className="ob-row-text">
                  <span className="ob-row-name">{t('accessibility_name')}</span>
                  <span className="ob-row-sub">{t('accessibility_desc')}</span>
                </div>
                {accessibilityGranted ? (
                  granted
                ) : (
                  <button
                    type="button"
                    className="ob-pill"
                    onClick={() => void allowAccessibility()}
                  >
                    {t('allow')}
                  </button>
                )}
              </div>
            </div>
          </>
        );
      }
      case 'preferences':
        return (
          <>
            <div className="ob-copy">
              <h1 className="ob-title">{t('prefs_title')}</h1>
              <p className="ob-desc">{t('prefs_desc')}</p>
            </div>
            <div className="ob-rows">
              <div className="ob-row">
                <IconGlobe size={18} />
                <div className="ob-row-text">
                  <span className="ob-row-name">{t('language_name')}</span>
                  {language === systemLanguage && (
                    <span className="ob-row-sub">{t('language_desc')}</span>
                  )}
                </div>
                <select
                  className="ob-select"
                  aria-label={t('language_name')}
                  value={language}
                  onChange={(event) => changeLanguage(event.target.value)}
                >
                  {SUPPORTED_LANGUAGES.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ob-row">
                <IconAnalytics size={18} />
                <div className="ob-row-text">
                  <span className="ob-row-name">{t('usage_name')}</span>
                  <span className="ob-row-sub">{t('usage_desc')}</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  className="ob-switch"
                  aria-checked={usage}
                  aria-label={t('usage_name')}
                  onClick={() => setUsage((value) => !value)}
                >
                  <i />
                </button>
              </div>
            </div>
          </>
        );
      case 'first-recording': {
        const failed = ffmpeg === 'failed';
        const percent =
          ffProgress.total > 0 ? Math.round((ffProgress.downloaded / ffProgress.total) * 100) : 0;
        return (
          <>
            <div className="ob-copy">
              <h1 className="ob-title">{t('record_title')}</h1>
              <p className="ob-desc">
                {ffmpeg === 'installing'
                  ? t('record_ffmpegDesc')
                  : failed
                    ? t('record_ffmpegFailedDesc')
                    : t('record_desc')}
              </p>
            </div>
            {(ffmpeg === 'installing' || failed) && (
              <div className="ob-rows">
                <div className="ob-row">
                  <IconDownload size={18} />
                  <div className="ob-row-text ob-row-stack">
                    <span className="ob-row-name">
                      {failed ? t('ffmpeg_failed') : t('ffmpeg_installing')}
                    </span>
                    <div
                      className="ob-progress"
                      data-tone={failed ? 'error' : undefined}
                      role="progressbar"
                      aria-valuenow={percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <i style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                  {failed ? (
                    <button type="button" className="ob-pill" onClick={installFfmpeg}>
                      {t('tryAgain')}
                    </button>
                  ) : (
                    ffProgress.total > 0 && (
                      <span className="ob-meta">
                        {t('ffmpeg_progress', {
                          downloaded: formatBytes(ffProgress.downloaded),
                          total: formatBytes(ffProgress.total),
                        })}
                      </span>
                    )
                  )}
                </div>
              </div>
            )}
          </>
        );
      }
      default:
        return (
          <div className="ob-copy">
            <h1 className="ob-title">{t('welcome_title')}</h1>
            <p className="ob-desc">{t('welcome_desc')}</p>
          </div>
        );
    }
  };

  if (!ready) {
    return <main className="ob-root ob-still" aria-busy="true" />;
  }

  return (
    <main
      className={still ? 'ob-root ob-still' : 'ob-root'}
      data-platform={platform}
      aria-label={t('windowLabel')}
    >
      <OnboardingHero
        step={step}
        language={language}
        name={name}
        email={email}
        productUpdates={productUpdates}
        screenOn={screenView === 'granted' || screenView === 'pending'}
      />

      {index > 0 && (
        <button
          type="button"
          className="ob-corner ob-corner-back app-no-drag"
          aria-label={t('back')}
          disabled={saving || relaunching}
          onClick={goBack}
        >
          <IconChevronLeft size={16} />
        </button>
      )}
      {canDismissOnboarding(step) && (
        <button
          type="button"
          className="ob-corner ob-corner-close app-no-drag"
          aria-label={t('close')}
          onClick={() => finish('editor')}
        >
          <IconX size={16} />
        </button>
      )}

      <div
        className="ob-dots"
        role="img"
        aria-label={t('stepOf', { current: index + 1, total: steps.length })}
      >
        {steps.map((item) => (
          <i key={item} />
        ))}
        <span className="ob-dot-ind" ref={dotRef} />
      </div>

      <div className="ob-panes" ref={panesRef}>
        {leaving && (
          <section
            key={`leaving-${leaving.key}`}
            className="ob-pane"
            data-leave={leaving.direction}
            aria-hidden="true"
            inert
          >
            {renderStep(leaving.step, false)}
          </section>
        )}
        <section
          key={step}
          ref={paneRef}
          className="ob-pane"
          data-enter={still ? undefined : direction}
        >
          {renderStep(step, true)}
        </section>
      </div>

      <div className="ob-foot" data-secondary={Boolean(footer.secondary)}>
        <button
          type="button"
          data-testid="onboarding-primary"
          className="ob-cta"
          disabled={footer.disabled}
          aria-busy={footer.busy || undefined}
          onClick={footer.onClick}
        >
          <span className="ob-cta-label">{footer.label}</span>
          {footer.busy && <IconLoading size={16} className="ob-cta-spin" aria-hidden="true" />}
        </button>
        {footer.secondary && (
          <button type="button" className="ob-ghost" onClick={footer.secondary.onClick}>
            {footer.secondary.label}
          </button>
        )}
      </div>
    </main>
  );
};
