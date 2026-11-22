import { useTranslation } from 'react-i18next';
import { Button } from 'src/lib/ui';
import { IconScissors, IconX } from 'src/lib/icons';
import { formatTime } from 'src/lib/utils';

/** Sticky bar over the transcript while words are selected: how much, cut, clear. */
export const TranscriptSelectionBar = ({
  count,
  duration,
  onCut,
  onClear,
}: {
  count: number;
  duration: number;
  onCut: () => void;
  onClear: () => void;
}) => {
  const { t } = useTranslation('captions');
  return (
    <div className="sticky top-0 z-10 mb-1.5 flex items-center gap-2 rounded-md border border-primary/25 bg-sf-panel px-2.5 py-1.5 shadow-[0_6px_16px_rgba(0,0,0,0.25)]">
      <span className="flex-1 text-xs text-sf-secondary">
        {t('selectionSummary', { count, duration: formatTime(duration) })}
      </span>
      <Button size="xs" className="gap-1.5" onClick={onCut}>
        <IconScissors size={12} />
        {t('cutFromVideo')}
      </Button>
      <Button variant="ghost" size="icon-xs" aria-label={t('clearSelection')} onClick={onClear}>
        <IconX size={13} />
      </Button>
    </div>
  );
};
