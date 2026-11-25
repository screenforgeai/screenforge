import { useTranslation } from 'react-i18next';
import { IconCheck, IconDeviceDesktop } from 'src/lib/icons';
import { formatScreenSize } from 'src/lib/recording/displayChoice';
import type { DesktopSource } from '../../../types/index';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../../lib/ui';
import { FloatingToolbarMenuEmptyState } from './FloatingToolbarMenuEmptyState';

interface FloatingToolbarDisplayPickerProps {
  /** The attached screens, in the order the OS lists them. */
  screens: DesktopSource[];
  /** The screen that will be recorded. */
  chosenScreen: DesktopSource | null;
  loading: boolean;
  /** Classes of the Display tab button (its active look included). */
  buttonClassName: string;
  onMenuOpenChange: (open: boolean) => void;
  /** The Display tab was clicked (its menu opens too). */
  onSelectTab: () => void;
  onChooseScreen: (screen: DesktopSource) => void;
  /** Where its menu and tooltip open: below the pill when the toolbar is its own window. */
  popSide?: 'top' | 'bottom';
  /** False when the toolbar is its own window: it grows to fit instead. */
  avoidCollisions?: boolean;
}

/**
 * The Display tab when several monitors are attached: it opens a menu to choose which one to
 * record, as Wayland's share dialog does on Linux.
 */
export const FloatingToolbarDisplayPicker = ({
  screens,
  chosenScreen,
  loading,
  buttonClassName,
  onMenuOpenChange,
  onSelectTab,
  onChooseScreen,
  popSide = 'top',
  avoidCollisions = true,
}: FloatingToolbarDisplayPickerProps) => {
  const { t } = useTranslation('toolbar');
  const labelOf = (screen: DesktopSource) =>
    screen.displayLabel ?? t('displayN', { n: screens.indexOf(screen) + 1 });
  const detailOf = (screen: DesktopSource) =>
    [formatScreenSize(screen), screen.isPrimary ? t('displayMain') : null]
      .filter(Boolean)
      .join(' · ');

  return (
    <DropdownMenu onOpenChange={onMenuOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('display')}
              onClick={onSelectTab}
              className={buttonClassName}
            >
              <IconDeviceDesktop size={16} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={popSide} avoidCollisions={avoidCollisions}>
          {chosenScreen ? `${t('display')}: ${labelOf(chosenScreen)}` : t('display')}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        side={popSide}
        avoidCollisions={avoidCollisions}
        sideOffset={10}
        align="center"
        className="min-w-[260px] max-h-72"
      >
        {loading && screens.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="size-4 text-sf-border fill-sf-primary" />
          </div>
        ) : screens.length === 0 ? (
          <FloatingToolbarMenuEmptyState
            icon={<IconDeviceDesktop size={16} />}
            title={t('noDisplays_title')}
            description={t('noDisplays_desc')}
          />
        ) : (
          screens.map((screen) => {
            const chosen = chosenScreen?.id === screen.id;
            const label = labelOf(screen);
            const detail = detailOf(screen);
            return (
              <DropdownMenuItem
                key={screen.id}
                textValue={label}
                onSelect={() => onChooseScreen(screen)}
                className={chosen ? 'bg-[#17171c] font-medium' : ''}
              >
                <div className="flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-sf-bg">
                  {screen.thumbnail ? (
                    <img src={screen.thumbnail} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <IconDeviceDesktop size={16} className="text-sf-secondary" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{label}</span>
                  {detail && <span className="truncate text-xs text-sf-secondary">{detail}</span>}
                </div>
                {chosen && <IconCheck size={12} className="shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
