import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { identifyUser, trackEvent } from 'src/lib/analytics';
import { SUPPORTED_LANGUAGES, type UserProfile } from 'src/lib/userProfile';
import { IconGlobe, IconUserAccount, IconX } from 'src/lib/icons';
import i18n from '../../../i18n';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../../lib/ui';

type Props = {
  open: boolean;
  onClose: () => void;
};

type SettingsSection = 'profile' | 'language';

export const SettingsModal = ({ open, onClose }: Props) => {
  const { t } = useTranslation('settings');
  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');

  const sectionMeta: Record<SettingsSection, { title: string; description: string }> = {
    profile: { title: t('profile_title'), description: t('profile_description') },
    language: { title: t('language_title'), description: t('language_description') },
  };

  const emptyProfile: UserProfile = { name: '', email: '' };

  // Profile state
  const [profile, setProfile] = useState<UserProfile>(emptyProfile);
  const [savedProfile, setSavedProfile] = useState<UserProfile>(emptyProfile);
  const [emailError, setEmailError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Language state — seed from i18n (already applied from saved settings on mount)
  const initialLang = i18n.language.split('-')[0];
  const [currentLang, setCurrentLang] = useState<string>(initialLang);
  const [savedLang, setSavedLang] = useState<string>(initialLang);

  const hasOpenedRef = useRef(false);

  // Load persisted settings from main process when modal opens
  useEffect(() => {
    if (!open) {
      if (hasOpenedRef.current) {
        trackEvent('settings_closed');
      }
      return;
    }
    hasOpenedRef.current = true;
    trackEvent('settings_opened');
    window.screenforge.getSettings().then((s) => {
      setProfile(s.profile);
      setSavedProfile(s.profile);
      const lang = s.language.split('-')[0];
      setCurrentLang(lang);
      setSavedLang(lang);
    });
  }, [open]);

  const profileDirty =
    profile.name.trim() !== savedProfile.name.trim() ||
    profile.email.trim() !== savedProfile.email.trim();
  const langDirty = currentLang !== savedLang;
  const isDirty = activeSection === 'profile' ? profileDirty : langDirty;

  const handleLangChange = (code: string) => {
    setCurrentLang(code);
  };

  const handleSave = async () => {
    if (activeSection === 'language') {
      setIsSaving(true);
      try {
        await Promise.all([
          window.screenforge.saveSettings({ language: currentLang }),
          new Promise((r) => setTimeout(r, 500)),
        ]);
        void i18n.changeLanguage(currentLang);
        setSavedLang(currentLang);
        trackEvent('settings_language_changed', { language: currentLang });
        toast.success(t('saved'));
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const trimmed = { name: profile.name.trim(), email: profile.email.trim() };

    if (trimmed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.email)) {
      setEmailError(t('emailAddress_invalid'));
      return;
    }

    setIsSaving(true);
    try {
      await Promise.all([
        window.screenforge.saveSettings({ profile: trimmed }),
        new Promise((r) => setTimeout(r, 500)),
      ]);
      identifyUser(trimmed);
      trackEvent('settings_profile_saved', {
        has_name: !!trimmed.name,
        has_email: !!trimmed.email,
      });

      setSavedProfile(trimmed);
      toast.success(t('saved'));
    } finally {
      setIsSaving(false);
    }
  };

  const { title, description } = sectionMeta[activeSection];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[460px] w-[560px] max-w-none overflow-hidden rounded-lg border-sf-border bg-sf-bg p-0 gap-0 shadow-none"
      >
        <Tabs
          value={activeSection}
          onValueChange={(v) => setActiveSection(v as SettingsSection)}
          orientation="vertical"
          className="flex flex-1 overflow-hidden"
        >
          {/* Left sidebar */}
          <div className="flex w-[160px] shrink-0 flex-col border-r border-sf-border px-2 py-4">
            <p className="mb-3 px-2 text-sm font-semibold text-sf-primary">{t('sidebarTitle')}</p>
            <TabsList>
              <TabsTrigger value="profile">
                <span data-tab-icon="">
                  <IconUserAccount size={15} />
                </span>
                {t('tabs_profile')}
              </TabsTrigger>
              <TabsTrigger value="language">
                <span data-tab-icon="">
                  <IconGlobe size={15} />
                </span>
                {t('tabs_language')}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Right panel */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <DialogHeader className="gap-0 border-b border-sf-border/70 px-5 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <DialogTitle className="text-lg font-semibold tracking-tight text-sf-primary">
                    {title}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-sm text-sf-secondary">
                    {description}
                  </DialogDescription>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={onClose}>
                  <IconX size={14} />
                </Button>
              </div>
            </DialogHeader>

            <TabsContent value="profile" className="flex-1 overflow-y-auto px-5 py-5">
              <div className="grid gap-4">
                <Input
                  id="settings-name"
                  label={t('displayName')}
                  value={profile.name}
                  placeholder={t('displayName_placeholder')}
                  className="h-9 bg-input/30"
                  labelProps={{ className: 'text-sm font-medium text-sf-primary' }}
                  onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                />
                <Input
                  id="settings-email"
                  type="email"
                  label={t('emailAddress')}
                  value={profile.email}
                  placeholder={t('emailAddress_placeholder')}
                  className="h-9 bg-input/30"
                  labelProps={{ className: 'text-sm font-medium text-sf-primary' }}
                  error={Boolean(emailError)}
                  errorText={emailError}
                  onChange={(e) => {
                    setEmailError('');
                    setProfile((p) => ({ ...p, email: e.target.value }));
                  }}
                />
              </div>
            </TabsContent>

            <TabsContent value="language" className="flex-1 overflow-y-auto px-5 py-5">
              <div className="grid gap-2">
                <label htmlFor="settings-language" className="text-sm font-medium text-sf-primary">
                  {t('interfaceLanguage')}
                </label>
                <Select value={currentLang} onValueChange={handleLangChange}>
                  <SelectTrigger
                    id="settings-language"
                    className="h-9 border-sf-border text-sm text-sf-primary focus:ring-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_LANGUAGES.map(({ code, label }) => (
                      <SelectItem key={code} value={code} className="text-sm">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            <DialogFooter className="items-center justify-end border-t border-sf-border/60 px-5 py-3">
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose}>
                  {t('cancel')}
                </Button>
                <Button
                  size="sm"
                  disabled={!isDirty || isSaving}
                  className="gap-1.5 shadow-none transition-transform active:scale-[0.98]"
                  onClick={() => void handleSave()}
                >
                  {isSaving && <Spinner className="size-3.5 fill-white text-white/30" />}
                  {t('save')}
                </Button>
              </div>
            </DialogFooter>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
