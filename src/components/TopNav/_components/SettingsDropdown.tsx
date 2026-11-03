import { useTranslation } from 'react-i18next';
import { IconLogoutSquare, IconSettings } from 'src/lib/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../../lib/ui';

const ProBadge = () => (
  <span
    className="shrink-0 rounded-full px-1.5 py-[2px] text-[10px] font-semibold uppercase tracking-wide"
    style={{
      background: 'rgba(196, 158, 72, 0.12)',
      border: '1px solid rgba(196, 158, 72, 0.28)',
      color: '#a07820',
    }}
  >
    Pro
  </span>
);

const EmailAvatar = ({ email }: { email: string }) => {
  const initial = email[0].toUpperCase();
  return (
    <div className="flex size-[30px] shrink-0 items-center justify-center rounded-[5px] bg-secondary text-[11px] font-semibold text-sf-secondary">
      {initial}
    </div>
  );
};

export const SettingsDropdown = () => {
  const { t } = useTranslation('topnav');
  const email: string | null = null;
  const signedIn = false;
  const isPro = false;

  const handleSignOut = () => {
    // void window.screenforge.signOut();
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('settingsLabel')}
              className="flex size-9 items-center justify-center rounded-md text-sf-secondary transition-colors hover:bg-secondary hover:text-sf-primary data-[state=open]:bg-secondary data-[state=open]:text-sf-primary"
            >
              <IconSettings className="size-4.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('settingsLabel')}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        side="right"
        align="end"
        className="w-60 shadow-[0_4px_24px_rgba(0,0,0,0.08)]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {false && email && (
          <>
            <div className="flex items-center gap-2.5 px-2.5 py-2.5">
              <EmailAvatar email={email} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="truncate text-sm font-medium leading-none text-sf-primary"
                    title={email}
                  >
                    {email}
                  </span>
                  {isPro && <ProBadge />}
                </div>
                <span className="text-[11px] leading-none text-sf-muted">
                  {t('personalAccount')}
                </span>
              </div>
            </div>
            <DropdownMenuSeparator />
          </>
        )}

        {false && signedIn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer gap-2.5" onSelect={handleSignOut}>
              <IconLogoutSquare size={14} className="shrink-0" />
              <span className="flex-1">{t('logOut')}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
