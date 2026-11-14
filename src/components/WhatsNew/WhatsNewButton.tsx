import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconMegaphone } from 'src/lib/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from 'src/lib/ui';
import { selectLatestRelease, type ReleaseNotes } from 'src/lib/whatsNew/changelog';
import { getBundledReleases } from 'src/lib/whatsNew/releaseNotes';
import { WhatsNewModal } from './WhatsNewModal';

const releaseForVersion = (version: string | null): ReleaseNotes[] => {
  const all = getBundledReleases();
  const match = version ? selectLatestRelease(all, version) : null;
  if (match) {
    return [match];
  }
  const newestWithNotes = all.find((r) => r.newItems.length > 0 || r.fixItems.length > 0);
  return newestWithNotes ? [newestWithNotes] : [];
};

/** Sidebar button that reopens the notes for the running version on demand. */
export const WhatsNewButton = () => {
  const { t } = useTranslation('whatsNew');
  const [releases, setReleases] = useState<ReleaseNotes[]>([]);
  const [open, setOpen] = useState(false);

  const handleOpen = async () => {
    const version = await window.screenforge.getAppVersion().catch(() => null);
    const releases = releaseForVersion(version);
    if (releases.length > 0) {
      setReleases(releases);
      setOpen(true);
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('open')}
            className="flex size-9 items-center justify-center rounded-md text-sf-secondary transition-colors hover:bg-secondary hover:text-sf-primary"
            onClick={() => void handleOpen()}
          >
            <IconMegaphone className="size-4.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('open')}</TooltipContent>
      </Tooltip>
      <WhatsNewModal open={open} releases={releases} onClose={() => setOpen(false)} />
    </>
  );
};
