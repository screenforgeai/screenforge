import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal } from 'lucide-react';
import { Button, Dialog, DialogContent, Spinner } from '../lib/ui';

type Phase = 'missing' | 'downloading' | 'success' | 'error';

interface FFmpegSetupModalProps {
  open: boolean;
  onReady: () => void;
}

const phaseVariants = {
  enter: { opacity: 0, y: 8 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FFmpegSetupModal = ({ open, onReady }: FFmpegSetupModalProps) => {
  const { t } = useTranslation('ffmpeg');
  const [phase, setPhase] = useState<Phase>('missing');
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open) {
      return;
    }

    const unsubProgress = window.screenforge.onInstallProgress(({ downloaded: d, total: t }) => {
      setDownloaded(d);
      setTotal(t);
    });

    const unsubDone = window.screenforge.onInstallDone(({ success, error }) => {
      if (success) {
        setPhase('success');
      } else {
        setPhase('error');
        setErrorMsg(error ?? t('desc_errorDefault'));
      }
    });

    return () => {
      unsubProgress();
      unsubDone();
    };
  }, [open, t]);

  const handleDownload = () => {
    setPhase('downloading');
    setDownloaded(0);
    setTotal(0);
    setErrorMsg('');
    window.screenforge.installFFmpeg();
  };

  const handleRetry = () => {
    setPhase('missing');
    setDownloaded(0);
    setTotal(0);
    setErrorMsg('');
  };

  const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="w-[460px] max-w-[94vw] gap-0 overflow-hidden rounded-[14px] border-sf-border bg-sf-bg p-0 shadow-2xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            variants={phaseVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {/* Body */}
            <div className="flex flex-col gap-5 px-7 pb-5 pt-7">
              {/* Icon + title */}
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5">
                  <Terminal size={22} className="text-sf-secondary" />
                </div>

                <div className="flex flex-col">
                  <h2 className="text-lg font-semibold">
                    {phase === 'missing' && t('title_missing')}
                    {phase === 'downloading' && t('title_downloading')}
                    {phase === 'success' && t('title_success')}
                    {phase === 'error' && t('title_error')}
                  </h2>
                  <p className="text-sm text-sf-secondary">
                    {phase === 'missing' && t('desc_missing')}
                    {phase === 'downloading' && t('desc_downloading')}
                    {phase === 'success' && t('desc_success')}
                    {phase === 'error' && errorMsg}
                  </p>
                </div>
              </div>

              {/* Download progress */}
              {phase === 'downloading' && (
                <div className="flex flex-col gap-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: total > 0 ? `${percent}%` : '0%' }}
                      transition={{ ease: 'linear', duration: 0.2 }}
                    />
                  </div>
                  <div className="flex items-center justify-between font-mono text-xs text-sf-muted">
                    <span>
                      {total > 0
                        ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
                        : t('connecting')}
                    </span>
                    {total > 0 && <span>{percent}%</span>}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-sf-border px-7 py-4">
          {phase === 'missing' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-sf-muted hover:text-sf-secondary"
                onClick={onReady}
              >
                {t('skipForNow')}
              </Button>
              <Button size="sm" onClick={handleDownload}>
                {t('installFFmpeg')}
              </Button>
            </>
          )}

          {phase === 'downloading' && (
            <Button size="sm" disabled className="gap-2">
              <Spinner className="size-3.5 fill-white text-white/30" />
              {t('installing')}
            </Button>
          )}

          {phase === 'success' && (
            <Button size="sm" onClick={onReady}>
              {t('continue')}
            </Button>
          )}

          {phase === 'error' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-sf-muted hover:text-sf-secondary"
                onClick={onReady}
              >
                {t('skipForNow')}
              </Button>
              <Button size="sm" variant="outline" onClick={handleRetry}>
                {t('tryAgain')}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export { FFmpegSetupModal };
