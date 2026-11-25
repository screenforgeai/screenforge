import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import wallpaperSrc from '../../assets/wallpapers/wallpaper-13.webp';
import appIconSrc from '../../assets/app-icon.png';
import {
  IconAppWindow,
  IconCheck,
  IconCrop,
  IconDeviceDesktop,
  IconGrip,
  IconMicrophone,
  IconUser,
  IconVideo,
  IconX,
} from '../../lib/icons';
import { SUPPORTED_LANGUAGES } from '../../lib/userProfile';
import { getInitials, type OnboardingStep } from '../../lib/onboarding/flow';

// Where the "camera" sits on the wallpaper for each step.
const FRAMING: Record<OnboardingStep, string> = {
  welcome: 'scale(1)',
  about: 'scale(1.3) translate(-7%, 5%)',
  permissions: 'scale(1.45) translate(9%, -3%)',
  preferences: 'scale(1.25) translate(-5%, -7%)',
  'first-recording': 'scale(1.08) translate(0, 3%)',
};

// A fixed moment for the menu bar clock, written in the viewer's language.
const MENU_BAR_TIME = new Date(2026, 10, 24, 9, 41);

type OnboardingHeroProps = {
  step: OnboardingStep;
  language: string;
  name: string;
  email: string;
  productUpdates: boolean;
  screenOn: boolean;
};

/** The picture at the top: a Mac screen with one piece of Screenforge on it per step. */
export const OnboardingHero = ({
  step,
  language,
  name,
  email,
  productUpdates,
  screenOn,
}: OnboardingHeroProps) => {
  const { t } = useTranslation('onboarding');
  const clock = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(language, {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(MENU_BAR_TIME);
    } catch {
      return '9:41';
    }
  }, [language]);
  const initials = getInitials(name);

  return (
    <div className="ob-hero app-drag" aria-hidden="true">
      <div className="ob-display">
        <img className="ob-wall" src={wallpaperSrc} alt="" style={{ transform: FRAMING[step] }} />
        <div className="ob-notch" />
        <div className="ob-menubar">
          <b>Screenforge</b>
          <span>{clock}</span>
        </div>

        <div className="ob-scene" data-on={step === 'welcome'}>
          <img className="ob-app-icon" src={appIconSrc} alt="" />
        </div>

        <div className="ob-scene" data-on={step === 'about'}>
          <div className="ob-glass ob-profile">
            <div className="ob-profile-who">
              <div className="ob-avatar">{initials || <IconUser size={18} />}</div>
              <div style={{ minWidth: 0 }}>
                <div className="ob-profile-name">{name.trim() || t('name_placeholder')}</div>
                <div className="ob-profile-email">{email.trim() || t('email_placeholder')}</div>
              </div>
            </div>
            <div className="ob-profile-sep" />
            <div className="ob-profile-opt">
              <span>{t('scene_productUpdates')}</span>
              <span className="ob-mini-switch" data-on={productUpdates}>
                <i />
              </span>
            </div>
          </div>
        </div>

        <div className="ob-scene ob-scene-top" data-on={step === 'permissions'}>
          <div className="ob-glass ob-settings">
            <div className="ob-settings-head">
              <IconDeviceDesktop size={16} />
              {t('scene_screenRecording')}
            </div>
            <div className="ob-settings-cap">{t('scene_screenRecordingCaption')}</div>
            <div className="ob-settings-app">
              <img src={appIconSrc} alt="" />
              <span>Screenforge</span>
              <span className="ob-mini-switch" data-on={screenOn}>
                <i />
              </span>
            </div>
          </div>
        </div>

        <div className="ob-scene ob-scene-menu" data-on={step === 'preferences'}>
          <div className="ob-glass ob-menu">
            {SUPPORTED_LANGUAGES.map((option) => (
              <div
                key={option.code}
                className="ob-menu-item"
                data-selected={option.code === language}
              >
                {option.label}
                {option.code === language && <IconCheck size={16} />}
              </div>
            ))}
          </div>
        </div>

        <div className="ob-scene" data-on={step === 'first-recording'}>
          <div className="ob-toolbar">
            <IconGrip size={16} />
            <span className="ob-toolbar-ic">
              <IconX size={16} />
            </span>
            <span className="ob-toolbar-div" />
            <span className="ob-toolbar-seg">
              <span className="ob-toolbar-ic" data-selected="true">
                <IconDeviceDesktop size={16} />
              </span>
              <span className="ob-toolbar-ic">
                <IconAppWindow size={16} />
              </span>
              <span className="ob-toolbar-ic">
                <IconCrop size={16} />
              </span>
            </span>
            <span className="ob-toolbar-div" />
            <span className="ob-toolbar-ic">
              <IconMicrophone size={16} />
            </span>
            <span className="ob-toolbar-ic">
              <IconVideo size={16} />
            </span>
            <span className="ob-toolbar-rec">
              <i />
              {t('scene_record')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
