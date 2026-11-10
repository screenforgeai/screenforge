import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDirectorAccount } from 'src/hooks/useDirectorAccount';
import { Button, Spinner } from '../../../lib/ui';

/** Settings › Director: the optional sign-in (screenforgeai/screenforge#25). */
export const DirectorAccountPanel = () => {
  const { t } = useTranslation('settings');
  const account = useDirectorAccount();
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (!account) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="size-4" />
      </div>
    );
  }

  if (account.status === 'signing-in') {
    return (
      <div className="grid gap-3">
        <div className="flex items-center gap-2 text-sm text-sf-primary">
          <Spinner className="size-3.5" />
          {t('director_waiting')}
        </div>
        <p className="text-sm text-sf-secondary">{t('director_waitingHint')}</p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.screenforge.openExternalUrl(account.approveUrl)}
          >
            {t('director_reopen')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void window.screenforge.cancelDirectorSignIn()}
          >
            {t('director_cancel')}
          </Button>
        </div>
      </div>
    );
  }

  if (account.status === 'signed-in') {
    return (
      <div className="grid gap-4">
        <div className="grid gap-1 rounded-md border border-sf-border px-3 py-2.5">
          <p className="text-sm text-sf-primary">
            {t('director_signedInAs', { email: account.user.email })}
          </p>
          <p className="text-sm text-sf-secondary">
            {t('director_workspace', {
              name: account.workspace.name ?? t('director_unnamedWorkspace'),
            })}
          </p>
        </div>
        <p className="text-sm text-sf-secondary">{t('director_signedInBody')}</p>
        {!account.remembered && (
          <p className="text-sm text-sf-secondary">{t('director_notRemembered')}</p>
        )}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={isSigningOut}
            className="gap-1.5"
            onClick={() => {
              setIsSigningOut(true);
              void window.screenforge.signOutOfDirector().finally(() => setIsSigningOut(false));
            }}
          >
            {isSigningOut && <Spinner className="size-3.5" />}
            {t('director_signOut')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-sf-secondary">{t('director_signedOutBody')}</p>
      {account.error && (
        <p role="alert" className="text-sm text-sf-red">
          {t(`director_error_${account.error}`)}
        </p>
      )}
      <div>
        <Button size="sm" onClick={() => void window.screenforge.signInToDirector()}>
          {t('director_signIn')}
        </Button>
      </div>
    </div>
  );
};
