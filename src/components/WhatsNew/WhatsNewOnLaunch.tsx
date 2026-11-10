import { useEffect, useState } from 'react';
import { selectReleases, type ReleaseNotes } from 'src/lib/whatsNew/changelog';
import { getBundledReleases } from 'src/lib/whatsNew/releaseNotes';
import { WhatsNewModal } from './WhatsNewModal';

type WhatsNewOnLaunchProps = {
  /** Hold the dialog back while a blocking startup dialog (e.g. FFmpeg setup) is up. */
  deferred?: boolean;
};

/** Opens "What's new" once after an update; mounted by the main window only. */
export const WhatsNewOnLaunch = ({ deferred = false }: WhatsNewOnLaunchProps) => {
  const [releases, setReleases] = useState<ReleaseNotes[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // No cancellation guard: the main process answers "show" only once, so a
    // StrictMode re-run must not throw the first answer away.
    window.screenforge
      .consumeWhatsNewOnLaunch()
      .then((launch) => {
        if (!launch.show) {
          return;
        }
        const unseen = selectReleases(getBundledReleases(), launch);
        if (unseen.length > 0) {
          setReleases(unseen);
          setOpen(true);
        }
      })
      .catch(() => undefined);
  }, []);

  return (
    <WhatsNewModal open={open && !deferred} releases={releases} onClose={() => setOpen(false)} />
  );
};
