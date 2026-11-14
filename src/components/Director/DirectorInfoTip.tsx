import { useTranslation } from 'react-i18next';
import { IconInfo } from 'src/lib/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../lib/ui';

/** An info icon beside the Screenforge Director name: what it is, in one line. */
export const DirectorInfoTip = () => {
  const { t } = useTranslation('common');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t('directorInfoLabel')}
          className="flex items-center text-sf-muted hover:text-sf-secondary transition-colors"
        >
          <IconInfo size={14} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        {t('directorInfo')}
      </TooltipContent>
    </Tooltip>
  );
};
