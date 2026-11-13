import { useTranslation } from 'react-i18next';
import { IconMicrophone, IconMicrophoneOff } from 'src/lib/icons';
import { ChevronDown } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../../lib/ui';
import { FloatingToolbarMenuEmptyState } from './FloatingToolbarMenuEmptyState';

type RecordState = 'idle' | 'countdown' | 'recording' | 'paused';

interface FloatingToolbarMicProps {
  recordState: RecordState;
  micEnabled: boolean;
  micLoading: boolean;
  micLevel: number;
  micDevices: MediaDeviceInfo[];
  selectedMicId: string | null;
  /** Why system audio won't be in the recording on this OS; null when it will. */
  systemAudioNotice?: string | null;
  onMenuOpenChange: (open: boolean) => void;
  onToggle: () => void;
  onSelectMicDevice: (deviceId: string) => void;
  onOpenMicMenu: () => void;
  /** Where its menu and tooltips open: below the pill when the toolbar is its own window. */
  popSide?: 'top' | 'bottom';
  /** False when the toolbar is its own window: it grows to fit instead. */
  avoidCollisions?: boolean;
}

export const FloatingToolbarMic = ({
  recordState,
  micEnabled,
  micLoading,
  micLevel,
  micDevices,
  selectedMicId,
  systemAudioNotice = null,
  onMenuOpenChange,
  onToggle,
  onSelectMicDevice,
  onOpenMicMenu,
  popSide = 'top',
  avoidCollisions = true,
}: FloatingToolbarMicProps) => {
  const { t } = useTranslation('toolbar');
  const isIdle = recordState === 'idle';
  const micLocked = !isIdle || micLoading;
  const toolbarButtonCls =
    'focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:border-transparent';
  const tooltipLabel = !isIdle
    ? t('micLocked')
    : micLoading
      ? t('loadingMicrophone')
      : micEnabled
        ? t('micOff')
        : t('micOn');

  return (
    <div className="flex items-center gap-1 rounded-full bg-sf-bg p-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={isIdle ? onToggle : undefined}
            disabled={micLocked}
            className={`${toolbarButtonCls} cursor-pointer rounded-full transition-colors ${
              micEnabled
                ? 'bg-[#1e1e22] text-sf-primary'
                : 'text-sf-secondary hover:text-sf-primary'
            }`}
          >
            {micLoading ? (
              <Spinner className="size-4 text-sf-border fill-sf-primary" />
            ) : micEnabled ? (
              <div className="relative">
                <IconMicrophone size={16} stroke={1.75} className="text-sf-secondary" />
                <div
                  className="pointer-events-none absolute inset-0 overflow-hidden"
                  style={{ clipPath: `inset(${(1 - micLevel) * 100}% 0 0 0)` }}
                >
                  <IconMicrophone size={16} stroke={1.75} className="text-sf-primary" />
                </div>
              </div>
            ) : (
              <IconMicrophoneOff size={16} stroke={1.75} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side={popSide} avoidCollisions={avoidCollisions}>
          {tooltipLabel}
          {isIdle && systemAudioNotice && (
            <span className="mt-1 block max-w-60 text-xs text-sf-secondary">
              {systemAudioNotice}
            </span>
          )}
        </TooltipContent>
      </Tooltip>

      <DropdownMenu
        onOpenChange={(open) => {
          onMenuOpenChange(open);
          if (open) {
            onOpenMicMenu();
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={micLocked || micDevices.length === 0}
                className={`${toolbarButtonCls} px-1.5 text-sf-primary/80 hover:bg-[#1e1e22] hover:text-sf-primary`}
              >
                <ChevronDown className="size-3.5" strokeWidth={2.25} />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side={popSide} avoidCollisions={avoidCollisions}>
            {t('micSource')}
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          side={popSide}
          avoidCollisions={avoidCollisions}
          sideOffset={10}
          align="center"
          className="min-w-55 max-h-56"
        >
          {micDevices.length === 0 ? (
            <FloatingToolbarMenuEmptyState
              icon={<IconMicrophoneOff size={16} stroke={1.75} />}
              title={t('noMicsFound')}
              description={t('noMicsFound_desc')}
            />
          ) : (
            <DropdownMenuRadioGroup
              value={selectedMicId ?? undefined}
              onValueChange={(value) => {
                onSelectMicDevice(value);
              }}
            >
              {micDevices.map((device, idx) => (
                <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
                  {device.label || t('microphoneN', { n: idx + 1 })}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          )}
          {systemAudioNotice && (
            <>
              <DropdownMenuSeparator />
              <p role="note" className="max-w-60 px-2 py-1.5 text-xs text-sf-secondary">
                {systemAudioNotice}
              </p>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
