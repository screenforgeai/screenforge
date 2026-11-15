import { useTranslation } from 'react-i18next';
import { IconCheck } from 'src/lib/icons';
import { Spinner, Tooltip, TooltipContent, TooltipTrigger } from 'src/lib/ui';
import { usePrerenderStore } from '../../../hooks/useExportPrerender';

/**
 * How much of the export is already rendered in the background, beside the
 * Export button. Right after an edit it shows "Preparing export" with the last
 * known share (never 100%) until the new plan reports the exact number.
 */
export const PrerenderIndicator = () => {
  const { t } = useTranslation('topnav');
  // Plain fields only: a selector returning a new object re-renders endlessly.
  const status = usePrerenderStore((state) => state.status);
  const stateVersion = usePrerenderStore((state) => state.stateVersion);
  const blocked = usePrerenderStore((state) => state.blocked);
  if (!status || status.total === 0) {
    return null;
  }

  const stale = status.stateVersion !== stateVersion;
  if (stale && blocked) {
    return null;
  }

  const share = Math.min(status.cached, status.total) / status.total;
  const ready = !stale && share >= 1;
  const active = stale || status.phase === 'planned' || status.phase === 'rendering';
  // An edit may have made some chunks stale, so an old 100% is not "ready".
  const percent = Math.floor(share * 100) - (stale && share >= 1 ? 1 : 0);
  const label = ready
    ? t('prerenderReady')
    : active
      ? t('prerenderPreparing', { percent })
      : t('prerenderPartial', { percent });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="status"
          aria-live="polite"
          className="mr-2 flex items-center gap-1.5 text-base text-sf-secondary tabular-nums"
        >
          {ready ? (
            <IconCheck size={14} className="shrink-0" />
          ) : active ? (
            <Spinner className="size-3.5 text-sf-border fill-sf-primary" />
          ) : null}
          <span>{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[220px] text-center">{t('prerenderHint')}</TooltipContent>
    </Tooltip>
  );
};
