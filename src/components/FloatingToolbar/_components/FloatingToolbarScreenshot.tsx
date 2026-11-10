import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trackEvent } from 'src/lib/analytics';
import {
  IconAppWindow,
  IconCamera,
  IconChevronDown,
  IconChevronRight,
  IconCrop,
  IconDeviceDesktop,
} from 'src/lib/icons';
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
import type { DesktopSource, ScreenshotCaptureRequest } from '../../../types/index';

const BUTTON_CLS =
  'focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:border-transparent cursor-pointer rounded-full text-sf-secondary hover:text-sf-primary';

type Target = { kind: 'display' } | { kind: 'area' } | { kind: 'window'; source: DesktopSource };

interface FloatingToolbarScreenshotProps {
  disabled: boolean;
  /** Display to grab for "Entire screen" (the toolbar's current display). */
  displaySourceId: string;
  windowSources: DesktopSource[];
  sourcesLoading: boolean;
  getWindowLabel: (source: DesktopSource) => string;
  ensurePermissions: () => Promise<boolean>;
  onMenuOpenChange: (open: boolean) => void;
}

/**
 * Toolbar entry for screenshot mode: grab the screen, an area or a window as a
 * still (no recording), then the main window opens the Screenshot editor.
 */
export const FloatingToolbarScreenshot = ({
  disabled,
  displaySourceId,
  windowSources,
  sourcesLoading,
  getWindowLabel,
  ensurePermissions,
  onMenuOpenChange,
}: FloatingToolbarScreenshotProps) => {
  const { t } = useTranslation('screenshot');
  // The window list stays folded under "Window" until asked for.
  const [windowsOpen, setWindowsOpen] = useState(false);

  const capture = async (target: Target) => {
    if (!(await ensurePermissions())) {
      return;
    }

    let request: ScreenshotCaptureRequest;
    if (target.kind === 'area') {
      const area = await window.screenforge.openAreaSelector('screenshot');
      if (!area) {
        return;
      }
      request = { kind: 'area', sourceId: displaySourceId, area };
    } else if (target.kind === 'window') {
      request = { kind: 'window', sourceId: target.source.id };
    } else {
      request = { kind: 'display', sourceId: displaySourceId };
    }

    try {
      await window.screenforge.captureScreenshot(request);
      trackEvent('screenshot_taken', { kind: request.kind });
    } catch (err) {
      window.screenforge.writeDiagnosticLog('toolbar.screenshot.failed', {
        kind: request.kind,
        message: err instanceof Error ? err.message : String(err),
      });
      trackEvent('screenshot_failed', { source: request.kind });
      window.screenforge.systemWarning(t('captureFailed'));
    }
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          setWindowsOpen(false);
        }
        onMenuOpenChange(open);
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={t('screenshot')}
              className={BUTTON_CLS}
            >
              <IconCamera size={16} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{t('screenshot')}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        side="top"
        sideOffset={10}
        align="center"
        className="min-w-[220px] max-h-72"
      >
        <DropdownMenuItem className="gap-2.5" onSelect={() => void capture({ kind: 'display' })}>
          <IconDeviceDesktop size={15} className="shrink-0 text-sf-secondary" />
          <span className="flex-1">{t('captureScreen')}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2.5" onSelect={() => void capture({ kind: 'area' })}>
          <IconCrop size={15} className="shrink-0 text-sf-secondary" />
          <span className="flex-1">{t('captureArea')}</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="gap-2.5"
          aria-expanded={windowsOpen}
          onSelect={(event) => {
            // Opens the list in place instead of closing the menu.
            event.preventDefault();
            setWindowsOpen((open) => !open);
          }}
        >
          <IconAppWindow size={15} className="shrink-0 text-sf-secondary" />
          <span className="flex-1">{t('captureWindow')}</span>
          {windowsOpen ? (
            <IconChevronDown size={14} className="shrink-0 text-sf-muted" />
          ) : (
            <IconChevronRight size={14} className="shrink-0 text-sf-muted" />
          )}
        </DropdownMenuItem>

        {windowsOpen &&
          (sourcesLoading ? (
            <div className="flex items-center justify-center py-3">
              <Spinner className="size-4 text-sf-border fill-sf-primary" />
            </div>
          ) : windowSources.length === 0 ? (
            <p className="py-2 pl-8 pr-2 text-xs text-sf-muted">{t('noWindows')}</p>
          ) : (
            windowSources.map((source) => (
              <DropdownMenuItem
                key={source.id}
                className="gap-2.5 pl-8"
                onSelect={() => void capture({ kind: 'window', source })}
              >
                {source.appIcon ? (
                  <img src={source.appIcon} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
                ) : (
                  <IconAppWindow size={15} className="shrink-0 text-sf-secondary" />
                )}
                <span className="flex-1 truncate">{getWindowLabel(source)}</span>
              </DropdownMenuItem>
            ))
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
