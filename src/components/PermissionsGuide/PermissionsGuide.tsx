import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '../../lib/ui';
import {
  IconCheck,
  IconDeviceDesktop,
  IconPointer,
  IconRestart,
  IconSettings,
} from '../../lib/icons';
import {
  createPermissionPoller,
  getMissingGuidedPermissions,
  getPermissionCardStatus,
  GUIDED_PERMISSIONS,
  type PermissionCardStatus,
} from '../../lib/permissionsGuide';
import { trackEvent } from '../../lib/analytics';
import { cn } from '../../lib/utils';
import type { GuidedPermission, RecordingPermissionsState } from '../../types';

export type PermissionsGuideCloseReason = 'done' | 'skipped';

type PermissionsGuideProps = {
  open: boolean;
  onClose: (reason: PermissionsGuideCloseReason) => void;
  onOpenSample?: () => void;
};

type IconComponent = ComponentType<{ size?: number; className?: string }>;

const PERMISSION_COPY: Record<
  GuidedPermission,
  {
    title: 'screenTitle' | 'accessibilityTitle';
    description: 'screenDescription' | 'accessibilityDescription';
    Icon: IconComponent;
  }
> = {
  screen: { title: 'screenTitle', description: 'screenDescription', Icon: IconDeviceDesktop },
  accessibility: {
    title: 'accessibilityTitle',
    description: 'accessibilityDescription',
    Icon: IconPointer,
  },
};

const STATUS_LABEL: Record<
  PermissionCardStatus,
  'statusGranted' | 'statusMissing' | 'statusWaiting'
> = {
  granted: 'statusGranted',
  missing: 'statusMissing',
  waiting: 'statusWaiting',
};

const PermissionsGuide = ({ open, onClose, onOpenSample }: PermissionsGuideProps) => {
  const { t } = useTranslation('onboarding');
  const [state, setState] = useState<RecordingPermissionsState | null>(null);
  const [settingsOpened, setSettingsOpened] = useState<Record<GuidedPermission, boolean>>({
    screen: false,
    accessibility: false,
  });

  // Poll while open so a grant in System Settings shows up without a restart,
  // and re-check right away when the user switches back to Screenforge.
  useEffect(() => {
    if (!open) {
      return;
    }
    const poller = createPermissionPoller(
      () => window.screenforge.getRecordingPermissions(),
      setState,
    );
    const onFocus = () => void poller.refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      poller.stop();
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      trackEvent('permissions_guide_shown');
    }
  }, [open]);

  const missing = state ? getMissingGuidedPermissions(state) : GUIDED_PERMISSIONS;
  const allGranted = state !== null && missing.length === 0;
  const cardStatuses = GUIDED_PERMISSIONS.map((permission) => ({
    permission,
    status: getPermissionCardStatus(state?.[permission] ?? 'unknown', settingsOpened[permission]),
  }));
  const isWaiting = cardStatuses.some(({ status }) => status === 'waiting');

  const handleOpenSettings = (permission: GuidedPermission) => {
    setSettingsOpened((prev) => ({ ...prev, [permission]: true }));
    trackEvent('permissions_guide_settings_opened', { permission });
    void window.screenforge.openPermissionSettings(permission).catch(() => undefined);
  };

  const handleClose = (reason: PermissionsGuideCloseReason) => {
    trackEvent('permissions_guide_closed', { reason, missing });
    onClose(reason);
  };

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="w-[520px] max-w-[94vw] gap-0 overflow-hidden rounded-[14px] border-sf-border bg-sf-bg p-0 shadow-2xl"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          handleClose(allGranted ? 'done' : 'skipped');
        }}
      >
        <div className="flex flex-col gap-5 px-7 pb-6 pt-7">
          <div className="flex flex-col gap-1.5">
            <DialogTitle className="text-lg font-semibold text-sf-primary">
              {t('guideTitle')}
            </DialogTitle>
            <DialogDescription className="text-sm text-sf-secondary">
              {allGranted ? t('allSet') : t('guideDescription')}
            </DialogDescription>
          </div>

          <div className="flex flex-col gap-2.5">
            {cardStatuses.map(({ permission, status }) => {
              const { title, description, Icon } = PERMISSION_COPY[permission];
              return (
                <section
                  key={permission}
                  role="group"
                  aria-label={t(title)}
                  className="flex items-start gap-3.5 rounded-xl border border-sf-border bg-sf-panel p-4"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-white/5">
                    <Icon size={18} className="text-sf-secondary" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-sf-primary">{t(title)}</span>
                      <span
                        className={cn(
                          'flex shrink-0 items-center gap-1 text-xs',
                          status === 'granted' ? 'text-sf-green' : 'text-sf-muted',
                        )}
                      >
                        {status === 'granted' && <IconCheck size={13} />}
                        {t(STATUS_LABEL[status])}
                      </span>
                    </div>
                    <p className="text-sm text-sf-secondary">{t(description)}</p>
                    {status !== 'granted' && (
                      <Button
                        size="sm"
                        variant={status === 'waiting' ? 'ghost' : 'default'}
                        className="mt-2 self-start"
                        onClick={() => handleOpenSettings(permission)}
                      >
                        <IconSettings size={14} />
                        {t('openSettings')}
                      </Button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {isWaiting && (
            <div className="flex items-center gap-3 rounded-xl border border-sf-border px-4 py-3">
              <p className="flex-1 text-xs text-sf-secondary">{t('relaunchHint')}</p>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  trackEvent('permissions_guide_relaunch', { missing });
                  window.screenforge.relaunchApp();
                }}
              >
                <IconRestart size={14} />
                {t('relaunch')}
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-sf-border px-7 py-4">
          {onOpenSample ? (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 text-sf-secondary"
              onClick={onOpenSample}
            >
              {t('trySample')}
            </Button>
          ) : (
            <span />
          )}
          {allGranted ? (
            <Button size="sm" onClick={() => handleClose('done')}>
              {t('done')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="text-sf-muted hover:text-sf-secondary"
              onClick={() => handleClose('skipped')}
            >
              {t('skip')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { PermissionsGuide };
