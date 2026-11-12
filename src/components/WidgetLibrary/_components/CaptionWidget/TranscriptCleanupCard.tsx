import { useTranslation } from 'react-i18next';
import { Button, Slider, Switch, SwitchThumb } from 'src/lib/ui';
import { IconScissors, IconX } from 'src/lib/icons';
import { cn, formatTime } from 'src/lib/utils';
import { sumRanges, type CleanupCut, type CleanupPlan } from 'src/lib/captions/transcriptEdit';

export interface CleanupSettings {
  fillers: boolean;
  silences: boolean;
  minSilence: number;
}

const categoryStat = (cuts: CleanupCut[]): string =>
  `${cuts.length} · ${formatTime(sumRanges(cuts.flatMap((c) => c.ranges)))}`;

const CleanupToggle = ({
  label,
  stat,
  checked,
  onCheckedChange,
}: {
  label: string;
  stat: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => (
  <label className="flex cursor-pointer items-center gap-2 text-sm text-sf-secondary">
    <Switch size="xs" checked={checked} onCheckedChange={onCheckedChange} aria-label={label}>
      <SwitchThumb />
    </Switch>
    <span className="flex-1">{label}</span>
    <span className={cn('font-mono text-xs', checked ? 'text-primary' : 'text-sf-muted')}>
      {stat}
    </span>
  </label>
);

/**
 * "Remove filler words & pauses": closed, a single button; open, the options and a
 * summary of what will be cut while the transcript highlights each cut.
 */
export const TranscriptCleanupCard = ({
  open,
  plan,
  settings,
  onOpen,
  onClose,
  onSettingsChange,
  onApply,
}: {
  open: boolean;
  plan: CleanupPlan | null;
  settings: CleanupSettings;
  onOpen: () => void;
  onClose: () => void;
  onSettingsChange: (settings: CleanupSettings) => void;
  onApply: () => void;
}) => {
  const { t } = useTranslation('captions');

  if (!open || !plan) {
    return (
      <Button variant="outline" size="sm" className="mb-3 w-full gap-2" onClick={onOpen}>
        <IconScissors size={14} />
        {t('cleanupOpen')}
      </Button>
    );
  }

  const fillerCuts = plan.cuts.filter((c) => c.kind === 'filler');
  const silenceCuts = plan.cuts.filter((c) => c.kind === 'silence');
  const hasCuts = plan.cuts.length > 0;

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-md border border-primary/25 bg-sf-panel p-3">
      <div className="flex items-center gap-2">
        <IconScissors size={16} className="text-primary" />
        <span className="flex-1 text-sm font-semibold text-sf-primary">{t('cleanupTitle')}</span>
        <Button variant="ghost" size="icon-xs" aria-label={t('cleanupClose')} onClick={onClose}>
          <IconX size={13} />
        </Button>
      </div>

      <CleanupToggle
        label={t('cleanupFillers')}
        stat={categoryStat(fillerCuts)}
        checked={settings.fillers}
        onCheckedChange={(fillers) => onSettingsChange({ ...settings, fillers })}
      />
      <CleanupToggle
        label={t('cleanupPauses')}
        stat={categoryStat(silenceCuts)}
        checked={settings.silences}
        onCheckedChange={(silences) => onSettingsChange({ ...settings, silences })}
      />
      {settings.silences && (
        <Slider
          min={0.5}
          max={3}
          step={0.25}
          inlineLabel={t('cleanupPausesLongerThan')}
          valueLabel={formatTime(settings.minSilence)}
          value={[settings.minSilence]}
          onValueChange={([minSilence]) => onSettingsChange({ ...settings, minSilence })}
        />
      )}

      <p className="text-xs text-sf-muted">{t('cleanupHint')}</p>

      {/* Summary on its own line: beside the buttons it wrapped to three lines. */}
      <div className="flex flex-col gap-2 border-t border-sf-border pt-3">
        <span className="text-xs text-sf-secondary">
          {hasCuts
            ? t('cleanupSummary', {
                count: plan.cuts.length,
                duration: formatTime(plan.totalDuration),
              })
            : t('cleanupNothing')}
        </span>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button size="sm" disabled={!hasCuts} onClick={onApply}>
            {t('cleanupApply')}
          </Button>
        </div>
      </div>
    </div>
  );
};
